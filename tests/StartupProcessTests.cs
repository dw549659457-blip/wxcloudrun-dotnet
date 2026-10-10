using System.Diagnostics;
using Xunit;

namespace Business.Tests;

public sealed class StartupProcessTests
{
    [Theory]
    [InlineData(false, "MYSQL_DATABASE")]
    [InlineData(true, "MYSQL_ALLOW_ROOT")]
    public async Task Invalid_production_configuration_exits_with_diagnostic_instead_of_aborting(bool databaseConfigured, string expectedVariable)
    {
        var dotnetRoot = Environment.GetEnvironmentVariable("DOTNET_ROOT");
        var executable = dotnetRoot is null ? "dotnet" : Path.Combine(dotnetRoot, "dotnet");
        var start = new ProcessStartInfo(executable)
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false
        };
        start.ArgumentList.Add(typeof(Program).Assembly.Location);
        foreach (var name in start.Environment.Keys.Where(name => name.StartsWith("MYSQL_", StringComparison.Ordinal)
            || name is "APP_COMMAND" or "DEV_LOGIN_ENABLED").ToArray())
        {
            start.Environment.Remove(name);
        }

        start.Environment["ASPNETCORE_ENVIRONMENT"] = "Production";
        start.Environment["DEV_LOGIN_ENABLED"] = "false";
        start.Environment["MYSQL_HOST"] = "127.0.0.1";
        start.Environment["MYSQL_USER"] = "root";
        start.Environment["MYSQL_PASSWORD"] = "startup-test-only-value";
        if (databaseConfigured)
        {
            start.Environment["MYSQL_DATABASE"] = "vegetable_test_configuration_only";
        }
        else
        {
            start.Environment["MYSQL_ALLOW_ROOT"] = "true";
        }

        using var process = Process.Start(start) ?? throw new InvalidOperationException("未能启动诊断测试进程");
        var output = process.StandardOutput.ReadToEndAsync();
        var error = process.StandardError.ReadToEndAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(20));
        try
        {
            await process.WaitForExitAsync(timeout.Token);
        }
        finally
        {
            if (!process.HasExited)
            {
                process.Kill(entireProcessTree: true);
            }
        }

        await output;
        var diagnostic = await error;
        Assert.Equal(1, process.ExitCode);
        Assert.Contains("STARTUP_FAILED", diagnostic);
        Assert.Contains(expectedVariable, diagnostic);
        Assert.DoesNotContain("Unhandled exception", diagnostic);
        Assert.DoesNotContain("startup-test-only-value", diagnostic);
    }
}
