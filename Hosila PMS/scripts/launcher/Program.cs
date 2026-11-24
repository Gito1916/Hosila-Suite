using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Threading;
using System.Windows.Forms;

namespace HosilaPMS
{
    internal static class Program
    {
        private const int DefaultPort = 3000;
        private const string MutexName = "Global\\HosilaPMS_HostServer_Mutex_v1";

        [STAThread]
        private static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            bool createdNew;
            using (var mutex = new Mutex(true, MutexName, out createdNew))
            {
                if (!createdNew)
                {
                    // Already running: just bring up the app window
                    OpenAppWindow("http://127.0.0.1:" + DefaultPort);
                    return;
                }

                using (var appContext = new HosilaTrayContext(DefaultPort))
                {
                    if (appContext.Start())
                    {
                        Application.Run(appContext);
                    }
                }
            }
        }

        internal static void OpenAppWindow(string url)
        {
            string browserExe = FindChromiumBrowser();
            if (browserExe != null)
            {
                string profileDir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "HosilaPMSProfile"
                );
                Directory.CreateDirectory(profileDir);

                var psi = new ProcessStartInfo
                {
                    FileName = browserExe,
                    Arguments =
                        "--app=" + url +
                        " --start-maximized" +
                        " --user-data-dir=\"" + profileDir + "\"" +
                        " --no-first-run --no-default-browser-check",
                    UseShellExecute = false
                };
                Process.Start(psi);
            }
            else
            {
                Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
            }
        }

        internal static string FindChromiumBrowser()
        {
            string pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            string pfx86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
            string localApp = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);

            string[] candidates =
            {
                Path.Combine(pfx86, @"Microsoft\Edge\Application\msedge.exe"),
                Path.Combine(pf, @"Microsoft\Edge\Application\msedge.exe"),
                Path.Combine(pf, @"Google\Chrome\Application\chrome.exe"),
                Path.Combine(pfx86, @"Google\Chrome\Application\chrome.exe"),
                Path.Combine(localApp, @"Google\Chrome\Application\chrome.exe")
            };
            foreach (string c in candidates)
            {
                if (File.Exists(c)) return c;
            }
            return null;
        }
    }

    internal sealed class HosilaTrayContext : ApplicationContext
    {
        private readonly int _port;
        private readonly string _baseDir;
        private readonly string _appDir;
        private readonly string _serverScript;
        private readonly string _dataDir;
        private readonly string _logFile;
        private readonly NotifyIcon _trayIcon;
        private Process _serverProc;
        private bool _exiting;

        public HosilaTrayContext(int port)
        {
            _port = port;
            _baseDir = AppDomain.CurrentDomain.BaseDirectory;
            _appDir = Path.Combine(_baseDir, "app");
            _serverScript = Path.Combine(_appDir, "dist-server", "server.mjs");
            _dataDir = ResolveDataDir(_baseDir);
            string logDir = Path.Combine(_dataDir, "logs");
            Directory.CreateDirectory(logDir);
            _logFile = Path.Combine(logDir, "server.log");

            Icon appIcon = Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? SystemIcons.Application;
            string lanUrl = GetPrimaryLanUrl(_port);

            var menu = new ContextMenuStrip();
            var openItem = new ToolStripMenuItem("Open Hosila PMS", null, (s, e) => OpenUi());
            openItem.Font = new Font(openItem.Font, FontStyle.Bold);

            menu.Items.Add(openItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(new ToolStripMenuItem("Copy LAN Link (" + lanUrl + ")", null, (s, e) => CopyLanLink()));
            menu.Items.Add(new ToolStripMenuItem("Open Data Folder", null, (s, e) => OpenFolder(_dataDir)));
            menu.Items.Add(new ToolStripMenuItem("View Server Log", null, (s, e) => OpenLogFile()));
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(new ToolStripMenuItem("Restart Local Server", null, (s, e) => RestartServer()));
            menu.Items.Add(new ToolStripMenuItem("Exit Hosila PMS", null, (s, e) => ExitApplication()));

            _trayIcon = new NotifyIcon
            {
                Icon = appIcon,
                Text = "Hosila PMS — Local Host (" + lanUrl + ")",
                ContextMenuStrip = menu,
                Visible = true
            };
            _trayIcon.DoubleClick += (s, e) => OpenUi();
        }

        public bool Start()
        {
            if (!File.Exists(_serverScript))
            {
                MessageBox.Show(
                    "Could not find Hosila PMS server bundle at:\n" + _serverScript,
                    "Hosila PMS",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
                _trayIcon.Visible = false;
                return false;
            }

            if (!StartServerProcess())
            {
                _trayIcon.Visible = false;
                return false;
            }

            OpenUi();
            _trayIcon.ShowBalloonTip(
                4000,
                "Hosila PMS is Running",
                "Other LAN workstations can connect at " + GetPrimaryLanUrl(_port),
                ToolTipIcon.Info
            );
            return true;
        }

        private bool StartServerProcess()
        {
            if (IsPortOpen(_port))
            {
                return true;
            }

            string nodeExe = FindNodeExe(_baseDir);
            if (nodeExe == null)
            {
                MessageBox.Show(
                    "Bundled runtime\\node.exe was not found and Node.js is not installed on this PC.",
                    "Hosila PMS",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
                return false;
            }

            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = nodeExe,
                    Arguments = "\"" + _serverScript + "\"",
                    WorkingDirectory = _appDir,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true
                };
                psi.EnvironmentVariables["NODE_ENV"] = "production";
                psi.EnvironmentVariables["PORT"] = _port.ToString();
                psi.EnvironmentVariables["HOSILA_DATA_DIR"] = _dataDir;

                _serverProc = new Process { StartInfo = psi, EnableRaisingEvents = true };
                _serverProc.OutputDataReceived += (s, e) => AppendLog(e.Data);
                _serverProc.ErrorDataReceived += (s, e) => AppendLog(e.Data);
                _serverProc.Start();
                _serverProc.BeginOutputReadLine();
                _serverProc.BeginErrorReadLine();

                for (int i = 0; i < 100; i++)
                {
                    if (_serverProc.HasExited)
                    {
                        MessageBox.Show(
                            "Hosila PMS local server exited unexpectedly (code " + _serverProc.ExitCode + ").\nCheck log: " + _logFile,
                            "Hosila PMS",
                            MessageBoxButtons.OK,
                            MessageBoxIcon.Error
                        );
                        return false;
                    }
                    if (IsPortOpen(_port)) return true;
                    Thread.Sleep(100);
                }

                MessageBox.Show(
                    "Hosila PMS server is taking longer than expected to start on port " + _port + ".\nCheck log: " + _logFile,
                    "Hosila PMS",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Warning
                );
                return true;
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "Failed to start Hosila PMS server:\n" + ex.Message,
                    "Hosila PMS",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
                return false;
            }
        }

        private void StopServerProcess()
        {
            if (_serverProc == null) return;
            try
            {
                if (!_serverProc.HasExited)
                {
                    _serverProc.Kill();
                    _serverProc.WaitForExit(3000);
                }
            }
            catch { }
            finally
            {
                try { _serverProc.Dispose(); } catch { }
                _serverProc = null;
            }
        }

        private void RestartServer()
        {
            StopServerProcess();
            Thread.Sleep(300);
            if (StartServerProcess())
            {
                _trayIcon.ShowBalloonTip(3000, "Hosila PMS", "Local server restarted.", ToolTipIcon.Info);
            }
        }

        private void OpenUi()
        {
            Program.OpenAppWindow("http://127.0.0.1:" + _port);
        }

        private void CopyLanLink()
        {
            string url = GetPrimaryLanUrl(_port);
            try
            {
                Clipboard.SetText(url);
                _trayIcon.ShowBalloonTip(3000, "LAN Link Copied", url + " copied to clipboard.", ToolTipIcon.Info);
            }
            catch { }
        }

        private void OpenFolder(string path)
        {
            try
            {
                Directory.CreateDirectory(path);
                Process.Start(new ProcessStartInfo("explorer.exe", "\"" + path + "\"") { UseShellExecute = true });
            }
            catch { }
        }

        private void OpenLogFile()
        {
            try
            {
                if (!File.Exists(_logFile)) File.WriteAllText(_logFile, "");
                Process.Start(new ProcessStartInfo(_logFile) { UseShellExecute = true });
            }
            catch { }
        }

        private void AppendLog(string line)
        {
            if (string.IsNullOrEmpty(line)) return;
            try
            {
                File.AppendAllText(_logFile, "[" + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "] " + line + Environment.NewLine);
            }
            catch { }
        }

        private void ExitApplication()
        {
            if (_exiting) return;
            _exiting = true;
            _trayIcon.Visible = false;
            StopServerProcess();
            ExitThread();
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                StopServerProcess();
                _trayIcon.Dispose();
            }
            base.Dispose(disposing);
        }

        private static string ResolveDataDir(string baseDir)
        {
            try
            {
                string progData = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
                if (!string.IsNullOrWhiteSpace(progData))
                {
                    string target = Path.Combine(progData, "Hosila PMS", "data");
                    Directory.CreateDirectory(target);
                    string probe = Path.Combine(target, ".write_test");
                    File.WriteAllText(probe, "ok");
                    File.Delete(probe);
                    return target;
                }
            }
            catch { }

            string fallback = Path.Combine(baseDir, "data");
            Directory.CreateDirectory(fallback);
            return fallback;
        }

        private static string FindNodeExe(string baseDir)
        {
            string bundled = Path.Combine(baseDir, "runtime", "node.exe");
            if (File.Exists(bundled)) return bundled;

            string[] candidates =
            {
                @"C:\Program Files\nodejs\node.exe",
                @"C:\Program Files (x86)\nodejs\node.exe",
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Programs\nodejs\node.exe")
            };
            foreach (string c in candidates)
            {
                if (File.Exists(c)) return c;
            }
            string pathEnv = Environment.GetEnvironmentVariable("PATH") ?? "";
            foreach (string dir in pathEnv.Split(';'))
            {
                if (string.IsNullOrWhiteSpace(dir)) continue;
                try
                {
                    string candidate = Path.Combine(dir.Trim(), "node.exe");
                    if (File.Exists(candidate)) return candidate;
                }
                catch { }
            }
            return null;
        }

        private static bool IsPortOpen(int port)
        {
            try
            {
                using (var client = new TcpClient())
                {
                    var result = client.BeginConnect("127.0.0.1", port, null, null);
                    bool success = result.AsyncWaitHandle.WaitOne(TimeSpan.FromMilliseconds(150));
                    if (!success) return false;
                    client.EndConnect(result);
                    return true;
                }
            }
            catch
            {
                return false;
            }
        }

        private static string GetPrimaryLanUrl(int port)
        {
            try
            {
                foreach (NetworkInterface ni in NetworkInterface.GetAllNetworkInterfaces())
                {
                    if (ni.OperationalStatus != OperationalStatus.Up) continue;
                    if (ni.NetworkInterfaceType == NetworkInterfaceType.Loopback ||
                        ni.NetworkInterfaceType == NetworkInterfaceType.Tunnel) continue;
                    foreach (UnicastIPAddressInformation ip in ni.GetIPProperties().UnicastAddresses)
                    {
                        if (ip.Address.AddressFamily == AddressFamily.InterNetwork && !IPAddress.IsLoopback(ip.Address))
                        {
                            return "http://" + ip.Address + ":" + port;
                        }
                    }
                }
            }
            catch { }
            return "http://localhost:" + port;
        }
    }
}

