using System;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;
using System.Threading;
using System.Windows.Forms;

namespace HosilaKeyGen
{
    internal static class Program
    {
        private const int Port = 4791;

        [STAThread]
        private static void Main()
        {
            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            string serverScript = Path.Combine(baseDir, "server.mjs");

            if (!File.Exists(serverScript))
            {
                MessageBox.Show(
                    "Could not find server.mjs in the same folder as Hosila KeyGen.exe.",
                    "Hosila KeyGen",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
                return;
            }

            string nodeExe = FindNodeExe();
            if (nodeExe == null)
            {
                MessageBox.Show(
                    "Node.js was not found. Please install Node.js 20+ LTS to run Hosila KeyGen.",
                    "Hosila KeyGen",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
                return;
            }

            Process serverProc = null;
            bool startedServerHere = false;

            try
            {
                if (!IsPortOpen(Port))
                {
                    var psi = new ProcessStartInfo
                    {
                        FileName = nodeExe,
                        Arguments = "\"" + serverScript + "\"",
                        WorkingDirectory = baseDir,
                        UseShellExecute = false,
                        CreateNoWindow = true,
                        WindowStyle = ProcessWindowStyle.Hidden
                    };
                    serverProc = Process.Start(psi);
                    startedServerHere = true;

                    for (int i = 0; i < 40; i++)
                    {
                        if (IsPortOpen(Port)) break;
                        Thread.Sleep(100);
                    }
                }

                string browserExe = FindChromiumBrowser();
                string url = "http://127.0.0.1:" + Port;

                if (browserExe != null)
                {
                    // Dedicated profile ensures --window-size is ALWAYS honored even if Edge/Chrome is already open
                    string profileDir = Path.Combine(
                        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                        "HosilaKeyGenProfile"
                    );
                    Directory.CreateDirectory(profileDir);

                    var bPsi = new ProcessStartInfo
                    {
                        FileName = browserExe,
                        Arguments =
                            "--app=" + url +
                            " --window-size=405,635" +
                            " --user-data-dir=\"" + profileDir + "\"" +
                            " --no-first-run --no-default-browser-check",
                        UseShellExecute = false
                    };
                    Process browserProc = Process.Start(bPsi);
                    if (browserProc != null)
                    {
                        browserProc.WaitForExit();
                    }
                }
                else
                {
                    Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
                    // Keep server alive briefly if opened in default browser
                    Thread.Sleep(60000);
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "Failed to launch Hosila KeyGen:\n" + ex.Message,
                    "Hosila KeyGen",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
            }
            finally
            {
                if (startedServerHere && serverProc != null)
                {
                    try
                    {
                        if (!serverProc.HasExited) serverProc.Kill();
                    }
                    catch { }
                }
            }
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

        private static string FindNodeExe()
        {
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

        private static string FindChromiumBrowser()
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
}

