using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace HosilaPMSUninstaller
{
    internal static class UninstallProgram
    {
        [STAThread]
        private static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new UninstallForm());
        }
    }

    internal sealed class UninstallForm : Form
    {
        private readonly string _installDir;
        private readonly string _programDataDir;
        private readonly string _dataDir;
        private readonly string _dbFile;
        private bool _backupCreated;
        private string _savedBackupPath;

        private readonly Label _backupStatusLabel;
        private readonly Button _backupBtn;
        private readonly Button _uninstallBtn;
        private readonly Button _cancelBtn;
        private readonly ProgressBar _progressBar;
        private readonly Label _statusLabel;

        private const string UninstallRegKey = @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\HosilaPMS";
        private const string RunRegKey = @"SOFTWARE\Microsoft\Windows\CurrentVersion\Run";
        private const string FirewallRuleName = "Hosila PMS Local Network (TCP 3000)";

        public UninstallForm()
        {
            _installDir = ResolveInstallDir();
            _programDataDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
                "Hosila PMS"
            );
            _dataDir = Path.Combine(_programDataDir, "data");
            _dbFile = Path.Combine(_dataDir, "hotel.db");

            Text = "Uninstall Hosila PMS";
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(520, 420);
            BackColor = Color.FromArgb(248, 249, 250);
            Font = new Font("Segoe UI", 9.5f);
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? SystemIcons.Application;

            // Header bar
            var header = new Panel
            {
                Dock = DockStyle.Top,
                Height = 76,
                BackColor = Color.FromArgb(20, 24, 28)
            };
            var titleLbl = new Label
            {
                Text = "Uninstall Hosila PMS",
                ForeColor = Color.White,
                Font = new Font("Segoe UI Semibold", 14f),
                Location = new Point(22, 14),
                AutoSize = true
            };
            var subLbl = new Label
            {
                Text = "Remove Hosila PMS completely from this computer",
                ForeColor = Color.FromArgb(170, 224, 204),
                Font = new Font("Segoe UI", 9f),
                Location = new Point(23, 44),
                AutoSize = true
            };
            header.Controls.Add(titleLbl);
            header.Controls.Add(subLbl);
            Controls.Add(header);

            // Backup recommendation card
            var backupCard = new Panel
            {
                Location = new Point(22, 92),
                Size = new Size(476, 118),
                BackColor = Color.FromArgb(238, 250, 245),
                BorderStyle = BorderStyle.FixedSingle
            };
            var backupTitle = new Label
            {
                Text = "Recommended: Create an External Backup Before Uninstalling",
                Font = new Font("Segoe UI Semibold", 9.5f),
                ForeColor = Color.FromArgb(18, 74, 56),
                Location = new Point(12, 10),
                AutoSize = true
            };
            var backupDesc = new Label
            {
                Text = "Save a copy of your hotel database to your Desktop or a USB drive in case you want to reinstall Hosila PMS later.",
                ForeColor = Color.FromArgb(40, 62, 54),
                Location = new Point(12, 32),
                Size = new Size(450, 34)
            };
            _backupBtn = new Button
            {
                Text = "Create Backup...",
                Location = new Point(12, 74),
                Size = new Size(145, 30),
                BackColor = Color.FromArgb(30, 128, 96),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Cursor = Cursors.Hand
            };
            _backupBtn.FlatAppearance.BorderSize = 0;
            _backupBtn.Click += (s, e) => CreateExternalBackup();

            _backupStatusLabel = new Label
            {
                Text = File.Exists(_dbFile) ? "Database found in C:\\ProgramData\\Hosila PMS\\data" : "No existing database detected.",
                ForeColor = Color.FromArgb(70, 90, 82),
                Location = new Point(168, 80),
                Size = new Size(296, 22),
                AutoEllipsis = true
            };
            if (!File.Exists(_dbFile))
            {
                _backupBtn.Enabled = false;
            }
            backupCard.Controls.Add(backupTitle);
            backupCard.Controls.Add(backupDesc);
            backupCard.Controls.Add(_backupBtn);
            backupCard.Controls.Add(_backupStatusLabel);
            Controls.Add(backupCard);

            // Warning panel
            var warnCard = new Panel
            {
                Location = new Point(22, 222),
                Size = new Size(476, 92),
                BackColor = Color.FromArgb(254, 242, 242),
                BorderStyle = BorderStyle.FixedSingle
            };
            var warnTitle = new Label
            {
                Text = "Complete Clean Removal",
                Font = new Font("Segoe UI Semibold", 9.5f),
                ForeColor = Color.FromArgb(153, 27, 27),
                Location = new Point(12, 8),
                AutoSize = true
            };
            var warnDesc = new Label
            {
                Text = "Uninstalling will permanently delete:\n" +
                       "• Program files (" + _installDir + ")\n" +
                       "• All app data, logs, and internal backups (" + _programDataDir + ")\n" +
                       "• Shortcuts, startup entry, browser profile, and LAN firewall rule",
                ForeColor = Color.FromArgb(115, 32, 32),
                Font = new Font("Segoe UI", 8.5f),
                Location = new Point(12, 28),
                Size = new Size(452, 58)
            };
            warnCard.Controls.Add(warnTitle);
            warnCard.Controls.Add(warnDesc);
            Controls.Add(warnCard);

            // Progress & status
            _statusLabel = new Label
            {
                Text = "Ready to uninstall.",
                ForeColor = Color.FromArgb(80, 86, 92),
                Location = new Point(22, 326),
                Size = new Size(476, 20)
            };
            _progressBar = new ProgressBar
            {
                Location = new Point(22, 348),
                Size = new Size(476, 14),
                Minimum = 0,
                Maximum = 100,
                Value = 0
            };
            Controls.Add(_statusLabel);
            Controls.Add(_progressBar);

            // Action buttons
            _cancelBtn = new Button
            {
                Text = "Cancel",
                Location = new Point(242, 374),
                Size = new Size(105, 32),
                FlatStyle = FlatStyle.System
            };
            _cancelBtn.Click += (s, e) => Close();

            _uninstallBtn = new Button
            {
                Text = "Uninstall Hosila PMS",
                Location = new Point(355, 374),
                Size = new Size(143, 32),
                BackColor = Color.FromArgb(204, 48, 48),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Cursor = Cursors.Hand
            };
            _uninstallBtn.FlatAppearance.BorderSize = 0;
            _uninstallBtn.Click += (s, e) => StartUninstall();

            Controls.Add(_cancelBtn);
            Controls.Add(_uninstallBtn);
        }

        private string ResolveInstallDir()
        {
            try
            {
                using (var key = Registry.LocalMachine.OpenSubKey(UninstallRegKey))
                {
                    if (key != null)
                    {
                        string loc = key.GetValue("InstallLocation") as string;
                        if (!string.IsNullOrWhiteSpace(loc)) return loc.TrimEnd('\\');
                    }
                }
            }
            catch { }
            return AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
        }

        private bool CreateExternalBackup()
        {
            if (!File.Exists(_dbFile))
            {
                MessageBox.Show("No Hosila PMS database was found to back up.", "Backup", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return false;
            }

            using (var sfd = new SaveFileDialog())
            {
                sfd.Title = "Save Hosila PMS Backup";
                sfd.Filter = "ZIP Backup Archive (*.zip)|*.zip";
                sfd.InitialDirectory = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                sfd.FileName = "Hosila-PMS-Backup-" + DateTime.Now.ToString("yyyyMMdd-HHmm") + ".zip";

                if (sfd.ShowDialog(this) != DialogResult.OK)
                {
                    return false;
                }

                string destZip = sfd.FileName;
                string normalizedDest = Path.GetFullPath(destZip);
                string normalizedProgData = Path.GetFullPath(_programDataDir);
                string normalizedInstall = Path.GetFullPath(_installDir);

                if (normalizedDest.StartsWith(normalizedProgData, StringComparison.OrdinalIgnoreCase) ||
                    normalizedDest.StartsWith(normalizedInstall, StringComparison.OrdinalIgnoreCase))
                {
                    MessageBox.Show(
                        "Please choose a folder outside Program Files and C:\\ProgramData\\Hosila PMS (for example, your Desktop, Documents, or a USB drive) so the backup is not deleted during uninstall.",
                        "Choose External Folder",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Warning
                    );
                    return false;
                }

                try
                {
                    // Stop running server briefly so SQLite WAL flushes cleanly before archiving
                    StopRunningHosilaProcesses();
                    Thread.Sleep(350);

                    string staging = Path.Combine(Path.GetTempPath(), "hosila-backup-" + Guid.NewGuid().ToString("N"));
                    Directory.CreateDirectory(staging);
                    try
                    {
                        foreach (string f in Directory.GetFiles(_dataDir, "hotel.db*"))
                        {
                            File.Copy(f, Path.Combine(staging, Path.GetFileName(f)), true);
                        }
                        File.WriteAllText(
                            Path.Combine(staging, "RESTORE_INSTRUCTIONS.txt"),
                            "Hosila PMS Database Backup\r\n" +
                            "Created: " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "\r\n\r\n" +
                            "To restore after reinstalling Hosila PMS:\r\n" +
                            "1. Exit Hosila PMS from the system tray.\r\n" +
                            "2. Copy hotel.db (and any hotel.db-wal / hotel.db-shm files) into:\r\n" +
                            "   C:\\ProgramData\\Hosila PMS\\data\\\r\n" +
                            "3. Launch Hosila PMS again.\r\n"
                        );

                        if (File.Exists(destZip)) File.Delete(destZip);
                        ZipFile.CreateFromDirectory(staging, destZip, CompressionLevel.Optimal, false);
                    }
                    finally
                    {
                        try { Directory.Delete(staging, true); } catch { }
                    }

                    _backupCreated = true;
                    _savedBackupPath = destZip;
                    _backupStatusLabel.Text = "Backup saved: " + Path.GetFileName(destZip);
                    _backupStatusLabel.ForeColor = Color.FromArgb(18, 110, 74);
                    MessageBox.Show(
                        "Backup saved successfully to:\n" + destZip,
                        "Backup Complete",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Information
                    );
                    return true;
                }
                catch (Exception ex)
                {
                    MessageBox.Show(
                        "Failed to create backup:\n" + ex.Message,
                        "Backup Error",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error
                    );
                    return false;
                }
            }
        }

        private void StartUninstall()
        {
            if (!_backupCreated && File.Exists(_dbFile))
            {
                var choice = MessageBox.Show(
                    "You have not created an external backup yet.\n\n" +
                    "Uninstalling will permanently delete your database and all internal backups in C:\\ProgramData\\Hosila PMS.\n\n" +
                    "Would you like to create a backup before uninstalling?",
                    "Create Backup Before Uninstalling?",
                    MessageBoxButtons.YesNoCancel,
                    MessageBoxIcon.Warning
                );

                if (choice == DialogResult.Cancel) return;
                if (choice == DialogResult.Yes)
                {
                    if (!CreateExternalBackup()) return;
                }
            }
            else
            {
                var confirm = MessageBox.Show(
                    "Are you sure you want to permanently uninstall Hosila PMS and wipe all application files, data, and internal backups?",
                    "Confirm Uninstall",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Question
                );
                if (confirm != DialogResult.Yes) return;
            }

            _backupBtn.Enabled = false;
            _uninstallBtn.Enabled = false;
            _cancelBtn.Enabled = false;

            var worker = new Thread(() => RunUninstall());
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

        private void RunUninstall()
        {
            try
            {
                SetProgress(15, "Stopping running Hosila PMS processes...");
                StopRunningHosilaProcesses();
                Thread.Sleep(500);

                SetProgress(30, "Removing shortcuts and startup entries...");
                RemoveShortcutsAndStartup();

                SetProgress(45, "Removing Windows Firewall rule...");
                RunHidden("netsh.exe", "advfirewall firewall delete rule name=\"" + FirewallRuleName + "\"");

                SetProgress(65, "Wiping application data, logs, and internal backups...");
                SafeDeleteDirectory(_programDataDir);

                string localProfile = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "HosilaPMSProfile"
                );
                SafeDeleteDirectory(localProfile);

                SetProgress(80, "Removing Windows Programs & Features registration...");
                try
                {
                    Registry.LocalMachine.DeleteSubKeyTree(UninstallRegKey, false);
                }
                catch { }

                SetProgress(92, "Removing Program Files installation directory...");
                string selfPath = Path.GetFullPath(Application.ExecutablePath);
                DeleteInstallContentsExceptSelf(_installDir, selfPath);

                SetProgress(100, "Uninstall complete.");

                Invoke(new Action(() =>
                {
                    string extra = _backupCreated
                        ? "\n\nYour external backup remains safely stored at:\n" + _savedBackupPath
                        : "";
                    MessageBox.Show(
                        "Hosila PMS has been completely uninstalled and all application files and internal backups have been removed." + extra,
                        "Uninstall Complete",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Information
                    );
                    ScheduleSelfCleanup(_installDir);
                    Application.Exit();
                }));
            }
            catch (Exception ex)
            {
                Invoke(new Action(() =>
                {
                    MessageBox.Show(
                        "An error occurred during uninstall:\n" + ex.Message,
                        "Uninstall Error",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error
                    );
                    _uninstallBtn.Enabled = true;
                    _cancelBtn.Enabled = true;
                }));
            }
        }

        private void StopRunningHosilaProcesses()
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
                string installLower = _installDir.ToLowerInvariant();
                foreach (Process p in Process.GetProcessesByName("node"))
                {
                    try
                    {
                        string path = p.MainModule != null ? p.MainModule.FileName : "";
                        if (!string.IsNullOrEmpty(path) && path.ToLowerInvariant().StartsWith(installLower))
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

        private static void RemoveShortcutsAndStartup()
        {
            string[] shortcuts =
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonDesktopDirectory), "Hosila PMS.lnk"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Hosila PMS.lnk")
            };
            foreach (string lnk in shortcuts)
            {
                try { if (File.Exists(lnk)) File.Delete(lnk); } catch { }
            }

            string startMenuDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.CommonPrograms),
                "Hosila PMS"
            );
            SafeDeleteDirectory(startMenuDir);

            try
            {
                using (var key = Registry.LocalMachine.OpenSubKey(RunRegKey, true))
                {
                    if (key != null) key.DeleteValue("HosilaPMS", false);
                }
            }
            catch { }
        }

        private static void SafeDeleteDirectory(string dir)
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

        private static void DeleteInstallContentsExceptSelf(string dir, string selfFullPath)
        {
            if (string.IsNullOrWhiteSpace(dir) || !Directory.Exists(dir)) return;
            foreach (string subDir in Directory.GetDirectories(dir))
            {
                SafeDeleteDirectory(subDir);
            }
            foreach (string file in Directory.GetFiles(dir))
            {
                if (string.Equals(Path.GetFullPath(file), selfFullPath, StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }
                try { File.Delete(file); } catch { }
            }
        }

        private static void ScheduleSelfCleanup(string installDir)
        {
            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = "cmd.exe",
                    Arguments = "/C ping 127.0.0.1 -n 3 > nul & rmdir /S /Q \"" + installDir + "\"",
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden
                };
                Process.Start(psi);
            }
            catch { }
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
                    if (p != null) p.WaitForExit(10000);
                }
            }
            catch { }
        }
    }
}

