namespace aspnetapp.Configuration;

public static class StartupDiagnostics
{
    public static void Report(Exception error)
    {
        var details = error.ToString();
        foreach (var name in new[] { "MYSQL_PASSWORD", "WECHAT_APP_SECRET", "INITIAL_ADMIN_PASSWORD", "DEV_SEED_PASSWORD" })
        {
            var secret = Environment.GetEnvironmentVariable(name);
            if (!string.IsNullOrEmpty(secret))
            {
                details = details.Replace(secret, "[REDACTED]", StringComparison.Ordinal);
            }
        }

        Console.Error.WriteLine("STARTUP_FAILED: 应用启动失败，请检查下面的异常与云托管服务环境变量。");
        Console.Error.WriteLine(details);
    }
}
