using aspnetapp.Configuration;
using MySqlConnector;
using Xunit;

namespace Business.Tests;

public sealed class CloudrunConfigurationTests
{
    [Theory]
    [InlineData(null, false)]
    [InlineData("false", false)]
    [InlineData("true", true)]
    public void Production_root_requires_explicit_opt_in_and_reads_injected_credentials(string? optIn, bool allowed)
    {
        var values = new Dictionary<string, string?>
        {
            ["ASPNETCORE_ENVIRONMENT"] = "Production",
            ["DEV_LOGIN_ENABLED"] = "false",
            ["MYSQL_ADDRESS"] = "10.40.100.75:3306",
            ["MYSQL_USERNAME"] = "root",
            ["MYSQL_PASSWORD"] = "only-a-unit-test-value",
            ["MYSQL_DATABASE"] = "vegetable_prod",
            ["MYSQL_HOST"] = null,
            ["MYSQL_PORT"] = null,
            ["MYSQL_USER"] = null,
            ["MYSQL_ALLOW_ROOT"] = optIn,
            ["APP_COMMAND"] = null
        };
        var previous = values.Keys.ToDictionary(name => name, Environment.GetEnvironmentVariable);
        try
        {
            foreach (var (name, value) in values)
            {
                Environment.SetEnvironmentVariable(name, value);
            }

            if (!allowed)
            {
                Assert.Throws<InvalidOperationException>(AppSettings.Load);
                return;
            }

            var settings = AppSettings.Load();
            var connection = new MySqlConnectionStringBuilder(settings.ConnectionString);
            Assert.True(settings.Production);
            Assert.False(settings.DevelopmentLogin);
            Assert.Equal("10.40.100.75", connection.Server);
            Assert.Equal(3306u, connection.Port);
            Assert.Equal("root", connection.UserID);
            Assert.Equal("vegetable_prod", connection.Database);
            Assert.Equal("only-a-unit-test-value", connection.Password);
        }
        finally
        {
            foreach (var (name, value) in previous)
            {
                Environment.SetEnvironmentVariable(name, value);
            }
        }
    }
}
