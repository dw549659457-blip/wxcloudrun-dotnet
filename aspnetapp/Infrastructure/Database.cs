using MySqlConnector;
using aspnetapp.Configuration;
using aspnetapp.Domain;
using System.Globalization;

namespace aspnetapp.Infrastructure;

/// <summary>连接显式传入 Repository；库存事务内禁止重新从连接池取连接。</summary>
public sealed class Database(AppSettings settings)
{
    public async Task<MySqlConnection> Open(CancellationToken cancellation = default)
    {
        var connection = new MySqlConnection(settings.ConnectionString);
        try
        {
            await connection.OpenAsync(cancellation);
            await Execute(connection, null, "SET time_zone = '+00:00'", cancellation: cancellation);
            return connection;
        }
        catch
        {
            await connection.DisposeAsync();
            throw;
        }
    }
    public static MySqlCommand Command(MySqlConnection connection, MySqlTransaction? transaction, string sql, params (string Name, object? Value)[] parameters)
    {
        var command = new MySqlCommand(sql, connection, transaction);
        foreach (var parameter in parameters)
        {
            command.Parameters.AddWithValue(parameter.Name, parameter.Value ?? DBNull.Value);
        }

        return command;
    }
    public static async Task<int> Execute(MySqlConnection connection, MySqlTransaction? transaction, string sql, (string Name, object? Value)[]? parameters = null, CancellationToken cancellation = default)
    {
        await using var command = Command(connection, transaction, sql, parameters ?? []);
        return await command.ExecuteNonQueryAsync(cancellation);
    }
    public static async Task<long> Insert(MySqlConnection connection, MySqlTransaction transaction, string sql, params (string Name, object? Value)[] parameters)
    {
        await using var command = Command(connection, transaction, sql, parameters);
        await command.ExecuteNonQueryAsync();
        return command.LastInsertedId;
    }
    public static async Task<List<Row>> Query(MySqlConnection connection, MySqlTransaction? transaction, string sql, params (string Name, object? Value)[] parameters)
    {
        await using var command = Command(connection, transaction, sql, parameters);
        await using var reader = await command.ExecuteReaderAsync();
        var rows = new List<Row>();
        while (await reader.ReadAsync())
        {
            var values = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
            for (var index = 0; index < reader.FieldCount; index++)
            {
                values[reader.GetName(index)] = reader.IsDBNull(index) ? null : reader.GetValue(index);
            }

            rows.Add(new Row(values));
        }
        return rows;
    }
}

public sealed class Row(Dictionary<string, object?> values)
{
    public string Text(string name) => Convert.ToString(values[name], CultureInfo.InvariantCulture) ?? "";
    public long Id(string name) => Convert.ToInt64(values[name], CultureInfo.InvariantCulture);
    public decimal Quantity(string name) => Convert.ToDecimal(values[name], CultureInfo.InvariantCulture);
    public bool Flag(string name) => Convert.ToBoolean(values[name], CultureInfo.InvariantCulture);
    public bool IsNull(string name) => values[name] is null;
    public DateTime DateTime(string name) => Convert.ToDateTime(values[name], CultureInfo.InvariantCulture);
    public Dictionary<string, object?> Output()
    {
        var result = new Dictionary<string, object?>();
        foreach (var entry in values)
        {
            var name = System.Text.Json.JsonNamingPolicy.CamelCase.ConvertName(entry.Key);
            result[name] = entry.Value is decimal quantity ? quantity.ToString("0.###", CultureInfo.InvariantCulture) : entry.Value;
        }
        return result;
    }
}
