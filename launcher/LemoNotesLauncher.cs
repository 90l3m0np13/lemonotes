using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Windows.Forms;

[assembly: System.Reflection.AssemblyTitle("LemoNotes")]
[assembly: System.Reflection.AssemblyProduct("LemoNotes")]
[assembly: System.Reflection.AssemblyDescription("LemoNotes: notas por voz y actas con zumo")]
[assembly: System.Reflection.AssemblyCompany("LemoNotes")]
[assembly: System.Reflection.AssemblyCopyright("Copyright © 2026 LemoNotes")]
[assembly: System.Reflection.AssemblyVersion("1.0.0.0")]
[assembly: System.Reflection.AssemblyFileVersion("1.0.0.0")]

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        string baseDir = AppDomain.CurrentDomain.BaseDirectory;
        string core = Path.Combine(baseDir, "LemoNotesCore.exe");

        if (!File.Exists(core))
        {
            MessageBox.Show(
                "No encuentro LemoNotesCore.exe.\r\n\r\nDescomprime el ZIP completo en una carpeta y ejecuta LemoNotes.exe desde dentro. No muevas solo el ejecutable.",
                "LemoNotes",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return;
        }

        StringBuilder arguments = new StringBuilder("--no-sandbox");
        foreach (string argument in args)
        {
            arguments.Append(' ');
            arguments.Append(Quote(argument));
        }

        ProcessStartInfo startInfo = new ProcessStartInfo(core)
        {
            UseShellExecute = false,
            WorkingDirectory = baseDir,
            CreateNoWindow = true,
            Arguments = arguments.ToString()
        };

        try
        {
            Process.Start(startInfo);
        }
        catch (Exception error)
        {
            MessageBox.Show(
                "No he podido abrir el núcleo de LemoNotes.\r\n\r\n" + error.Message,
                "LemoNotes",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
    }

    private static string Quote(string value)
    {
        if (string.IsNullOrEmpty(value)) return "\"\"";
        if (value.IndexOfAny(new[] { ' ', '\t', '"' }) < 0) return value;
        return "\"" + value.Replace("\"", "\\\"") + "\"";
    }
}
