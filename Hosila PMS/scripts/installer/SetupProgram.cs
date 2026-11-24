using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace HosilaPMSSetup
{
    internal static class SetupProgram
    {
        [STAThread]
        private static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new SetupForm());
        }
    }

    internal sealed class SetupForm : Form
    {
        private const string AppName = "Hosila PMS";
        private static readonly string AppVersion = BuildInfo.Version;
        private const string Publisher = "Hosila";
        private const string PayloadResourceName = "HosilaPayload.zip";
        private const string UninstallRegKey = @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\HosilaPMS";
        private const string RunRegKey = @"SOFTWARE\Microsoft\Windows\CurrentVersion\Run";
        private const string FirewallRuleName = "Hosila PMS Local Network (TCP 3000)";

        private enum InstallMode { Fresh, Upgrade, Repair, BlockedDowngrade }

        private readonly InstallMode _mode;
        private readonly string _existingVersion;
        private readonly string _existingInstallDir;

        private readonly TextBox _pathBox;
        private readonly Button _browseBtn;
        private readonly CheckBox _desktopChk;
        private readonly CheckBox _startupChk;
        private readonly CheckBox _firewallChk;
        private readonly CheckBox _launchAfterChk;
        private readonly ProgressBar _progressBar;
        private readonly Label _statusLabel;
        private readonly Button _installBtn;
        private readonly Button _cancelBtn;

        private bool _installed;

        public SetupForm()
        {
            DetectExistingInstallation(out _existingVersion, out _existingInstallDir, out _mode);

            Text = "Hosila PMS Setup v" + AppVersion;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(540, 465);
            BackColor = Color.FromArgb(248, 249, 250);
            Font = new Font("Segoe UI", 9.5f);
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? SystemIcons.Application;

            // Header banner
            var header = new Panel
            {
                Dock = DockStyle.Top,
                Height = 82,
                BackColor = Color.FromArgb(20, 24, 28)
            };
            var titleLbl = new Label
            {
                Text = _mode == InstallMode.Upgrade
                    ? "Upgrade Hosila PMS to v" + AppVersion
                    : _mode == InstallMode.Repair
                        ? "Repair / Reinstall Hosila PMS v" + AppVersion
                        : "Hosila PMS Setup · v" + AppVersion,
                ForeColor = Color.White,
                Font = new Font("Segoe UI Semibold", 14.5f),
                Location = new Point(22, 14),
                AutoSize = true
            };
            var subLbl = new Label
            {
                Text = _mode == InstallMode.Upgrade
                    ? "Detected v" + _existingVersion + " · Automatic backup + non-destructive update"
                    : _mode == InstallMode.BlockedDowngrade
                        ? "Newer version v" + _existingVersion + " is already installed"
                        : "Offline-first Property Management System · Single-Host LAN Edition",
                ForeColor = _mode == InstallMode.BlockedDowngrade
                    ? Color.FromArgb(248, 150, 150)
                    : Color.FromArgb(106, 212, 176),
                Font = new Font("Segoe UI", 9f),
                Location = new Point(23, 47),
                AutoSize = true
            };
            header.Controls.Add(titleLbl);
            header.Controls.Add(subLbl);
            Controls.Add(header);

            // Install folder section
            var pathLbl = new Label
            {
                Text = _mode == InstallMode.Fresh ? "Installation Folder:" : "Existing Installation Folder:",
                Font = new Font("Segoe UI Semibold", 9.5f),
                Location = new Point(22, 98),
                AutoSize = true
            };
            string defaultDir = !string.IsNullOrWhiteSpace(_existingInstallDir)
                ? _existingInstallDir
                : Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                    "Hosila PMS"
                );
            _pathBox = new TextBox
            {
                Text = defaultDir,
                Location = new Point(22, 122),
                Size = new Size(406, 25),
                ReadOnly = _mode != InstallMode.Fresh
            };
            _browseBtn = new Button
            {
                Text = "Browse...",
                Location = new Point(436, 120),
                Size = new Size(82, 27),
                FlatStyle = FlatStyle.System,
                Enabled = _mode == InstallMode.Fresh
            };
            _browseBtn.Click += (s, e) => BrowseFolder();

            Controls.Add(pathLbl);
            Controls.Add(_pathBox);
            Controls.Add(_browseBtn);

            // Environment options card
            var optCard = new Panel
            {
                Location = new Point(22, 160),
                Size = new Size(496, 166),
                BackColor = Color.White,
                BorderStyle = BorderStyle.FixedSingle
            };
            var optTitle = new Label
            {
                Text = _mode == InstallMode.Upgrade
                    ? "Safe Upgrade Protection (v" + _existingVersion + " -> v" + AppVersion + ")"
                    : "Automatic Environment Setup",
                Font = new Font("Segoe UI Semibold", 9.5f),
                ForeColor = Color.FromArgb(28, 34, 40),
                Location = new Point(14, 10),
                AutoSize = true
            };
            _desktopChk = new CheckBox
            {
                Text = "Create Desktop shortcut for Hosila PMS",
                Checked = true,
                Location = new Point(14, 36),
                AutoSize = true
            };
            _startupChk = new CheckBox
            {
                Text = "Start Hosila PMS automatically when Windows starts",
                Checked = true,
                Location = new Point(14, 62),
                AutoSize = true
            };
            _firewallChk = new CheckBox
            {
                Text = "Configure Windows Firewall (LAN Port 3000) & disable AC sleep",
                Checked = true,
                Location = new Point(14, 88),
                AutoSize = true
            };
            var dataNote = new Label
            {
                Text = _mode == InstallMode.Upgrade || _mode == InstallMode.Repair
                    ? "Your database in C:\\ProgramData\\Hosila PMS\\data will NOT be overwritten.\nAn automatic pre-upgrade backup will be saved before updating app files."
                    : "Database & backups are stored safely in C:\\ProgramData\\Hosila PMS\\data\nFuture updates preserve all hotel data and migrate the schema automatically.",
                ForeColor = Color.FromArgb(46, 104, 80),
                Font = new Font("Segoe UI", 8.5f),
                Location = new Point(14, 118),
                Size = new Size(468, 36)
            };
            optCard.Controls.Add(optTitle);
            optCard.Controls.Add(_desktopChk);
            optCard.Controls.Add(_startupChk);
            optCard.Controls.Add(_firewallChk);
            optCard.Controls.Add(dataNote);
            Controls.Add(optCard);

            // Progress & status
            _statusLabel = new Label
            {
                Text = _mode == InstallMode.BlockedDowngrade
                    ? "A newer version (v" + _existingVersion + ") is installed. Downgrading is disabled to protect your data."
                    : _mode == InstallMode.Upgrade
                        ? "Ready to upgrade Hosila PMS from v" + _existingVersion + " to v" + AppVersion + "."
                        : _mode == InstallMode.Repair
                            ? "Hosila PMS v" + AppVersion + " is already installed. Click Repair to refresh app files."
                            : "Click Install to install Hosila PMS and configure this Host PC.",
                ForeColor = _mode == InstallMode.BlockedDowngrade
                    ? Color.FromArgb(180, 35, 35)
                    : Color.FromArgb(75, 82, 90),
                Location = new Point(22, 340),
                Size = new Size(496, 20)
            };
            _progressBar = new ProgressBar
            {
                Location = new Point(22, 364),
                Size = new Size(496, 16),
                Minimum = 0,
                Maximum = 100,
                Value = 0
            };
            Controls.Add(_statusLabel);
            Controls.Add(_progressBar);

            _launchAfterChk = new CheckBox
            {
                Text = "Launch Hosila PMS now",
                Checked = true,
                Visible = false,
                Location = new Point(22, 414),
                AutoSize = true
            };
            Controls.Add(_launchAfterChk);

            // Buttons
            _cancelBtn = new Button
            {
                Text = _mode == InstallMode.BlockedDowngrade ? "Close" : "Cancel",
                Location = new Point(272, 408),
                Size = new Size(105, 34),
                FlatStyle = FlatStyle.System
            };
            _cancelBtn.Click += (s, e) => Close();

            _installBtn = new Button
            {
                Text = _mode == InstallMode.Upgrade
                    ? "Upgrade to v" + AppVersion
                    : _mode == InstallMode.Repair
                        ? "Repair / Reinstall"
                        : "Install Hosila PMS",
                Location = new Point(385, 408),
                Size = new Size(133, 34),
                BackColor = _mode == InstallMode.BlockedDowngrade
                    ? Color.FromArgb(160, 165, 170)
                    : Color.FromArgb(30, 128, 96),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Cursor = Cursors.Hand,
                Enabled = _mode != InstallMode.BlockedDowngrade
            };
            _installBtn.FlatAppearance.BorderSize = 0;
            _installBtn.Click += (s, e) => OnPrimaryButtonClick();

            Controls.Add(_cancelBtn);
            Controls.Add(_installBtn);
        }

        private static void DetectExistingInstallation(out string existingVersion, out string existingDir, out InstallMode mode)
        {
            existingVersion = null;
            existingDir = null;
            mode = InstallMode.Fresh;

            try
            {
                using (var key = Registry.LocalMachine.OpenSubKey(UninstallRegKey))
                {
                    if (key == null) return;
                    existingVersion = key.GetValue("DisplayVersion") as string;
                    existingDir = key.GetValue("InstallLocation") as string;

                    if (string.IsNullOrWhiteSpace(existingVersion)) return;

                    Version installedVer;
                    Version installerVer;
                    if (Version.TryParse(existingVersion.Trim(), out installedVer) &&
                        Version.TryParse(AppVersion.Trim(), out installerVer))
                    {
                        int cmp = installerVer.CompareTo(installedVer);
                        if (cmp > 0) mode = InstallMode.Upgrade;
                        else if (cmp == 0) mode = InstallMode.Repair;
                        else mode = InstallMode.BlockedDowngrade;
                    }
                    else
                    {
                        mode = InstallMode.Upgrade;
                    }
                }
            }
            catch { }
        }

        private void BrowseFolder()
        {
            using (var fbd = new FolderBrowserDialog())
            {
                fbd.Description = "Choose installation folder for Hosila PMS";
                fbd.SelectedPath = _pathBox.Text;
                if (fbd.ShowDialog(this) == DialogResult.OK)
                {
                    string selected = fbd.SelectedPath;
                    if (!selected.EndsWith("Hosila PMS", StringComparison.OrdinalIgnoreCase))
                    {
                        selected = Path.Combine(selected, "Hosila PMS");
                    }
                    _pathBox.Text = selected;
                }
            }
        }

        private void OnPrimaryButtonClick()
        {
            if (_installed)
            {
                if (_launchAfterChk.Checked)
                {
                    string exePath = Path.Combine(_pathBox.Text.Trim(), "Hosila PMS.exe");
                    if (File.Exists(exePath))
                    {
                        Process.Start(new ProcessStartInfo(exePath)
                        {
                            WorkingDirectory = _pathBox.Text.Trim(),
                            UseShellExecute = true
                        });
                    }
                }
                Close();
                return;
            }

            string targetDir = _pathBox.Text.Trim();
            if (string.IsNullOrWhiteSpace(targetDir))
            {
                MessageBox.Show("Please specify a valid installation folder.", AppName, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            bool createDesktop = _desktopChk.Checked;
            bool addStartup = _startupChk.Checked;
            bool setupFirewall = _firewallChk.Checked;

            _pathBox.Enabled = false;
            _browseBtn.Enabled = false;
            _desktopChk.Enabled = false;
            _startupChk.Enabled = false;
            _firewallChk.Enabled = false;
            _installBtn.Enabled = false;
            _cancelBtn.Enabled = false;

            var worker = new Thread(() => RunInstall(targetDir, createDesktop, addStartup, setupFirewall));
            worker.IsBackground = true;
            worker.Start();
        }

        private void SetProgress(int pct, string msg)
        {
            if (InvokeRequired)
            {
                BeginInvoke(new Action(() => SetProgress(pct, msg)));
                return;
            }
            _progressBar.Value = Math.Max(0, Math.Min(100, pct));
            _statusLabel.Text = msg;
        }

        private void RunInstall(string targetDir, bool createDesktop, bool addStartup, bool setupFirewall)
        {
            try
            {
                SetProgress(6, "Stopping any running Hosila PMS instances...");
                StopRunningHosilaProcesses(targetDir);
                Thread.Sleep(450);

                string progDataRoot = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
                    "Hosila PMS"
                );
                string dataDir = Path.Combine(progDataRoot, "data");
                string logDir = Path.Combine(dataDir, "logs");
                Directory.CreateDirectory(logDir);

                // Automatic pre-upgrade database safety backup (preserves all user data)
                string existingDb = Path.Combine(dataDir, "hotel.db");
                if (File.Exists(existingDb))
                {
                    SetProgress(12, "Creating automatic pre-upgrade database backup...");
                    CreatePreUpgradeBackup(dataDir, _existingVersion ?? "unknown", AppVersion);
                }

                // Clean stale app/ and runtime/ folders on upgrade so old chunks & node_modules don't linger
                if (_mode == InstallMode.Upgrade || _mode == InstallMode.Repair)
                {
                    SetProgress(16, "Cleaning previous application files (keeping your database safe)...");
                    SafeDeleteSubdir(Path.Combine(targetDir, "app"));
                    SafeDeleteSubdir(Path.Combine(targetDir, "runtime"));
                }

                SetProgress(20, "Extracting Hosila PMS v" + AppVersion + " application files...");
                ExtractEmbeddedPayload(targetDir);

                SetProgress(64, "Verifying persistent database directory & permissions...");
                // Grant BUILTIN\Users (S-1-5-32-545) Modify access so non-admin staff can run Hosila PMS
                RunHidden("icacls.exe", "\"" + progDataRoot + "\" /grant *S-1-5-32-545:(OI)(CI)M /T /Q");

                if (setupFirewall)
                {
                    SetProgress(74, "Configuring Windows Firewall (TCP 3000) & power settings...");
                    RunHidden("netsh.exe", "advfirewall firewall delete rule name=\"" + FirewallRuleName + "\"");
                    RunHidden(
                        "netsh.exe",
                        "advfirewall firewall add rule name=\"" + FirewallRuleName + "\" dir=in action=allow protocol=TCP localport=3000 profile=private"
                    );
                    RunHidden("powercfg.exe", "/change standby-timeout-ac 0");
                }

                SetProgress(86, "Creating Start Menu & Desktop shortcuts...");
                string mainExe = Path.Combine(targetDir, "Hosila PMS.exe");
                string uninstallExe = Path.Combine(targetDir, "Uninstall Hosila PMS.exe");

                string startMenuDir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.CommonPrograms),
                    "Hosila PMS"
                );
                Directory.CreateDirectory(startMenuDir);
                CreateShortcut(Path.Combine(startMenuDir, "Hosila PMS.lnk"), mainExe, targetDir, "Launch Hosila PMS");
                CreateShortcut(Path.Combine(startMenuDir, "Uninstall Hosila PMS.lnk"), uninstallExe, targetDir, "Uninstall Hosila PMS");

                if (createDesktop)
                {
                    string desktopLnk = Path.Combine(
                        Environment.GetFolderPath(Environment.SpecialFolder.CommonDesktopDirectory),
                        "Hosila PMS.lnk"
                    );
                    CreateShortcut(desktopLnk, mainExe, targetDir, "Launch Hosila PMS");
                }

                if (addStartup)
                {
                    using (var runKey = Registry.LocalMachine.CreateSubKey(RunRegKey))
                    {
                        if (runKey != null) runKey.SetValue("HosilaPMS", "\"" + mainExe + "\"");
                    }
                }

                SetProgress(95, "Registering Hosila PMS in Windows Installed Apps...");
                RegisterInAddRemovePrograms(targetDir, mainExe, uninstallExe);

                SetProgress(100, _mode == InstallMode.Upgrade
                    ? "Upgrade to v" + AppVersion + " complete! Your database is preserved and ready."
                    : "Installation complete! Hosila PMS v" + AppVersion + " is ready to use.");

                Invoke(new Action(() =>
                {
                    _installed = true;
                    _launchAfterChk.Visible = true;
                    _installBtn.Text = "Finish";
                    _installBtn.Enabled = true;
                    _cancelBtn.Visible = false;
                }));
            }
            catch (Exception ex)
            {
                Invoke(new Action(() =>
                {
                    MessageBox.Show(
                        "Installation failed:\n" + ex.Message,
                        "Hosila PMS Setup Error",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error
                    );
                    _pathBox.Enabled = true;
                    _browseBtn.Enabled = true;
                    _desktopChk.Enabled = true;
                    _startupChk.Enabled = true;
                    _firewallChk.Enabled = true;
                    _installBtn.Enabled = true;
                    _cancelBtn.Enabled = true;
                }));
            }
        }

        private void ExtractEmbeddedPayload(string targetDir)
        {
            Directory.CreateDirectory(targetDir);
            string tempZip = Path.Combine(Path.GetTempPath(), "hosila-setup-" + Guid.NewGuid().ToString("N") + ".zip");
            try
            {
                using (Stream resStream = Assembly.GetExecutingAssembly().GetManifestResourceStream(PayloadResourceName))
                {
                    if (resStream == null)
                    {
                        throw new InvalidOperationException("Embedded installer payload (" + PayloadResourceName + ") is missing.");
                    }
                    using (var fs = File.Create(tempZip))
                    {
                        resStream.CopyTo(fs);
                    }
                }

                using (var archive = ZipFile.OpenRead(tempZip))
                {
                    int total = Math.Max(1, archive.Entries.Count);
                    int done = 0;
                    foreach (var entry in archive.Entries)
                    {
                        done++;
                        string relPath = entry.FullName.Replace('/', '\\');
                        // Strip leading "Hosila-PMS\" folder if present in archive
                        if (relPath.StartsWith("Hosila-PMS\\", StringComparison.OrdinalIgnoreCase))
                        {
                            relPath = relPath.Substring("Hosila-PMS\\".Length);
                        }
                        if (string.IsNullOrWhiteSpace(relPath)) continue;

                        string destPath = Path.Combine(targetDir, relPath);
                        if (relPath.EndsWith("\\"))
                        {
                            Directory.CreateDirectory(destPath);
                        }
                        else
                        {
                            string parent = Path.GetDirectoryName(destPath);
                            if (!string.IsNullOrEmpty(parent)) Directory.CreateDirectory(parent);
                            entry.ExtractToFile(destPath, true);
                        }

                        if (done % 40 == 0 || done == total)
                        {
                            int pct = 18 + (int)((done / (double)total) * 42.0);
                            SetProgress(pct, "Installing files (" + done + " / " + total + ")...");
                        }
                    }
                }
            }
            finally
            {
                try { if (File.Exists(tempZip)) File.Delete(tempZip); } catch { }
            }
        }

        private static void RegisterInAddRemovePrograms(string installDir, string mainExe, string uninstallExe)
        {
            long totalBytes = 0;
            try
            {
                foreach (string f in Directory.GetFiles(installDir, "*", SearchOption.AllDirectories))
                {
                    totalBytes += new FileInfo(f).Length;
                }
            }
            catch { }

            using (var key = Registry.LocalMachine.CreateSubKey(UninstallRegKey))
            {
                if (key == null) return;
                key.SetValue("DisplayName", AppName);
                key.SetValue("DisplayVersion", AppVersion);
                key.SetValue("Publisher", Publisher);
                key.SetValue("InstallLocation", installDir);
                key.SetValue("DisplayIcon", mainExe);
                key.SetValue("UninstallString", "\"" + uninstallExe + "\"");
                key.SetValue("QuietUninstallString", "\"" + uninstallExe + "\"");
                key.SetValue("EstimatedSize", (int)(totalBytes / 1024), RegistryValueKind.DWord);
                key.SetValue("NoModify", 1, RegistryValueKind.DWord);
                key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
            }
        }

        private static void CreateShortcut(string shortcutPath, string targetExe, string workingDir, string description)
        {
            Type shellType = Type.GetTypeFromProgID("WScript.Shell");
            if (shellType == null) return;
            object shell = Activator.CreateInstance(shellType);
            object shortcut = shellType.InvokeMember(
                "CreateShortcut",
                BindingFlags.InvokeMethod,
                null,
                shell,
                new object[] { shortcutPath }
            );
            Type scType = shortcut.GetType();
            scType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, shortcut, new object[] { targetExe });
            scType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, shortcut, new object[] { workingDir });
            scType.InvokeMember("IconLocation", BindingFlags.SetProperty, null, shortcut, new object[] { targetExe + ",0" });
            scType.InvokeMember("Description", BindingFlags.SetProperty, null, shortcut, new object[] { description });
            scType.InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, null);
        }

        private static void StopRunningHosilaProcesses(string targetDir)
        {
            try
            {
                foreach (Process p in Process.GetProcessesByName("Hosila PMS"))
                {
                    try { p.Kill(); p.WaitForExit(3000); } catch { }
                }
            }
            catch { }

            try
            {
                string targetLower = targetDir.ToLowerInvariant();
                foreach (Process p in Process.GetProcessesByName("node"))
                {
                    try
                    {
                        string path = p.MainModule != null ? p.MainModule.FileName : "";
                        if (!string.IsNullOrEmpty(path) && path.ToLowerInvariant().StartsWith(targetLower))
                        {
                            p.Kill();
                            p.WaitForExit(3000);
                        }
                    }
                    catch { }
                }
            }
            catch { }
        }

        private static void CreatePreUpgradeBackup(string dataDir, string fromVer, string toVer)
        {
            try
            {
                string backupsDir = Path.Combine(dataDir, "backups");
                Directory.CreateDirectory(backupsDir);
                string stamp = DateTime.Now.ToString("yyyyMMdd-HHmmss");
                string zipPath = Path.Combine(
                    backupsDir,
                    "pre-upgrade-v" + fromVer + "-to-v" + toVer + "-" + stamp + ".zip"
                );

                string staging = Path.Combine(Path.GetTempPath(), "hosila-preup-" + Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(staging);
                try
                {
                    foreach (string f in Directory.GetFiles(dataDir, "hotel.db*"))
                    {
                        File.Copy(f, Path.Combine(staging, Path.GetFileName(f)), true);
                    }
                    if (File.Exists(zipPath)) File.Delete(zipPath);
                    ZipFile.CreateFromDirectory(staging, zipPath, CompressionLevel.Optimal, false);
                }
                finally
                {
                    try { Directory.Delete(staging, true); } catch { }
                }
            }
            catch
            {
                // Best-effort safety backup; do not fail install if backup copy hits transient lock
            }
        }

        private static void SafeDeleteSubdir(string dir)
        {
            if (string.IsNullOrWhiteSpace(dir) || !Directory.Exists(dir)) return;
            for (int attempt = 0; attempt < 3; attempt++)
            {
                try
                {
                    Directory.Delete(dir, true);
                    return;
                }
                catch
                {
                    Thread.Sleep(300);
                }
            }
        }

        private static void RunHidden(string exe, string args)
        {
            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = exe,
                    Arguments = args,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden
                };
                using (var p = Process.Start(psi))
                {
                    if (p != null) p.WaitForExit(15000);
                }
            }
            catch { }
        }
    }
}

