using System.Net;
using System.Text.Json;
using aspnetapp.Domain;
using aspnetapp.Repositories;
using ClosedXML.Excel;
using Xunit;
using static Business.Tests.TestFixture;

namespace Business.Tests;

public sealed class InventoryTests(TestFixture fixture) : IClassFixture<TestFixture>
{
    private static readonly DateOnly Day = new(2026, 10, 1);
    [Fact]
    public async Task Complete_business_cycle_keeps_packaging_conservation_and_correct_direct_sign()
    {
        // Arrange：每个测试使用独立品类，真实 MySQL 库存不是内存替身。
        var (packaging, vegetable) = await fixture.Stock();
        var batch = await fixture.Dispatch(packaging);
        // Act：任务书完整闭环，作业不入仓，部分回收不确认损耗。
        await fixture.Create("worker1", "work-records", new(Day, [new(packaging, 70)], batch, Vegetables: [new(vegetable, 70)]));
        Assert.Equal(900, await fixture.Balance(packaging)); Assert.Equal(0, await fixture.Balance(vegetable));
        await fixture.Create("driver1", "recoveries", new(Day, [new(packaging, 10)], batch, Vegetables: [new(vegetable, 40)], Mode: "PARTIAL"));
        var partial = await Json(await fixture.Clients["driver1"].GetAsync($"/api/batches/{batch}/summary"));
        Assert.Equal("OPEN", partial.GetProperty("batch").GetProperty("status").GetString());
        Assert.Equal("0", partial.GetProperty("packaging")[0].GetProperty("lost").GetString());
        await fixture.Create("driver1", "recoveries", new(Day, [new(packaging, 15)], batch, Vegetables: [new(vegetable, 28)], Mode: "FINAL", ConfirmFinal: true, LossReason: "损坏5个", DifferenceReason: "实收少2箱"));
        Assert.Equal(925, await fixture.Balance(packaging)); Assert.Equal(68, await fixture.Balance(vegetable));
        await fixture.Create("outbound1", "outbounds", new(Day, [new(vegetable, 50)], CustomerId: fixture.Customer));
        var direct = await fixture.Create("outbound1", "outbounds", new(Day, [new(vegetable, 10)], CustomerId: fixture.Customer, Mode: "DIRECT", Remark: "外来菜来源说明"));
        // Assert：实际数量正数、展示负数，白菜剩8；D=C+R+L+O。
        Assert.Equal(8, await fixture.Balance(vegetable));
        var summary = await Json(await fixture.Clients["driver1"].GetAsync($"/api/batches/{batch}/summary"));
        var balance = summary.GetProperty("packaging")[0];
        Assert.Equal("100", balance.GetProperty("dispatched").GetString());
        Assert.Equal("70", balance.GetProperty("consumed").GetString());
        Assert.Equal("25", balance.GetProperty("recovered").GetString());
        Assert.Equal("5", balance.GetProperty("lost").GetString());
        Assert.Equal("0", balance.GetProperty("outstanding").GetString());
        Assert.Equal("2", summary.GetProperty("vegetables")[0].GetProperty("difference").GetString());
        var detail = await Json(await fixture.Clients["outbound1"].GetAsync($"/api/outbounds/{direct}"));
        Assert.Equal("10", detail.GetProperty("items")[0].GetProperty("quantity").GetString());
        Assert.Equal("-10", detail.GetProperty("items")[0].GetProperty("displayQuantity").GetString());
        var list = await Json(await fixture.Clients["outbound1"].GetAsync("/api/outbounds"));
        var directListItem = list.GetProperty("items").EnumerateArray().First(item => item.GetProperty("id").GetInt64() == direct);
        Assert.Equal("10", directListItem.GetProperty("displayItems")[0].GetProperty("actualQuantity").GetString());
        Assert.Equal("-10", directListItem.GetProperty("displayItems")[0].GetProperty("displayQuantity").GetString());
        var repeated = await Send(fixture.Clients["driver1"], HttpMethod.Post, "/api/recoveries", new DraftInput(new(Day, [], batch, Mode: "FINAL", ConfirmFinal: true), true));
        Assert.Equal(HttpStatusCode.Conflict, repeated.StatusCode);
        var work = await Send(fixture.Clients["worker1"], HttpMethod.Post, "/api/work-records", new DraftInput(new(Day, [new(packaging, 1)], batch, Vegetables: [new(vegetable, 1)]), true));
        Assert.Equal(HttpStatusCode.Conflict, work.StatusCode);
        Assert.Empty(await new ReportRepository(fixture.Database).Reconcile());
    }
    [Fact]
    public async Task Multiple_growers_are_independent_and_one_insufficient_line_rolls_back_entire_dispatch()
    {
        var (packaging, vegetable) = await fixture.Stock(200);
        var second = await fixture.Archive("packaging-types", "个");
        var failed = await Send(fixture.Clients["driver1"], HttpMethod.Post, "/api/dispatches", new DraftInput(new(Day, [new(packaging, 20, fixture.Grower), new(second, 1, fixture.Grower2)]), true));
        Assert.Equal(HttpStatusCode.Conflict, failed.StatusCode); Assert.Equal(200, await fixture.Balance(packaging));
        var dispatch = await fixture.Create("driver1", "dispatches", new(Day, [new(packaging, 40, fixture.Grower), new(packaging, 10, fixture.Grower), new(packaging, 50, fixture.Grower2)]));
        var firstBatch = await fixture.Batch(dispatch); var secondBatch = await fixture.Batch(dispatch, fixture.Grower2);
        await fixture.Create("driver1", "recoveries", new(Day, [new(packaging, 50)], firstBatch, Mode: "FINAL", ConfirmFinal: true));
        var remaining = await Json(await fixture.Clients["driver1"].GetAsync($"/api/batches/{secondBatch}/summary"));
        Assert.Equal("OPEN", remaining.GetProperty("batch").GetProperty("status").GetString());
        Assert.Equal("50", remaining.GetProperty("packaging")[0].GetProperty("outstanding").GetString());
        Assert.Equal(150, await fixture.Balance(packaging));
    }
    [Fact]
    public async Task Concurrent_workers_cannot_consume_more_than_external_balance()
    {
        var (packaging, vegetable) = await fixture.Stock(); var batch = await fixture.Dispatch(packaging, 100);
        var request = new DraftInput(new(Day, [new(packaging, 70)], batch, Vegetables: [new(vegetable, 70)]), true);
        var results = await Task.WhenAll(Send(fixture.Clients["worker1"], HttpMethod.Post, "/api/work-records", request), Send(fixture.Clients["worker2"], HttpMethod.Post, "/api/work-records", request));
        Assert.Single(results, response => response.IsSuccessStatusCode); Assert.Single(results, response => response.StatusCode == HttpStatusCode.Conflict);
        Assert.Equal(900, await fixture.Balance(packaging));
        var summary = await Json(await fixture.Clients["driver1"].GetAsync($"/api/batches/{batch}/summary"));
        Assert.Equal("30", summary.GetProperty("packaging")[0].GetProperty("outstanding").GetString());
        Assert.Empty(await new ReportRepository(fixture.Database).Reconcile());
    }
    [Fact]
    public async Task Concurrent_outbounds_use_independent_transactions_and_never_make_stock_negative()
    {
        var (_, vegetable) = await fixture.Stock(0, 10);
        var request = new DraftInput(new(Day, [new(vegetable, 7)], CustomerId: fixture.Customer), true);
        var results = await Task.WhenAll(Send(fixture.Clients["outbound1"], HttpMethod.Post, "/api/outbounds", request), Send(fixture.Clients["outbound1"], HttpMethod.Post, "/api/outbounds", request));
        Assert.Single(results, response => response.IsSuccessStatusCode); Assert.Single(results, response => response.StatusCode == HttpStatusCode.Conflict);
        Assert.Equal(3, await fixture.Balance(vegetable));
        var failure = await Json(Assert.Single(results, response => response.StatusCode == HttpStatusCode.Conflict));
        Assert.Equal(JsonValueKind.String, failure.GetProperty("details").GetProperty("available").ValueKind);
        // 确认连接池提供两个实际不同的 MySQL 会话，而不是内存或单连接模拟并发。
        await using var first = await fixture.Database.Open(); await using var second = await fixture.Database.Open();
        var firstId = (await aspnetapp.Infrastructure.Database.Query(first, null, "SELECT CONNECTION_ID() AS Id"))[0].Id("Id");
        var secondId = (await aspnetapp.Infrastructure.Database.Query(second, null, "SELECT CONNECTION_ID() AS Id"))[0].Id("Id");
        Assert.NotEqual(firstId, secondId);
    }
    [Fact]
    public async Task Idempotency_returns_original_result_and_conflicts_on_changed_payload()
    {
        var (_, vegetable) = await fixture.Stock(0, 30); var key = Guid.NewGuid().ToString("N");
        var request = new DraftInput(new(Day, [new(vegetable, 5)], CustomerId: fixture.Customer), true);
        var responses = await Task.WhenAll(Send(fixture.Clients["outbound1"], HttpMethod.Post, "/api/outbounds", request, key), Send(fixture.Clients["outbound1"], HttpMethod.Post, "/api/outbounds", request, key));
        Assert.All(responses, response => Assert.True(response.IsSuccessStatusCode));
        Assert.Equal((await Json(responses[0])).GetProperty("id").GetInt64(), (await Json(responses[1])).GetProperty("id").GetInt64());
        Assert.Equal(25, await fixture.Balance(vegetable));
        var changed = request with { Document = request.Document with { Items = [new(vegetable, 6)] } };
        Assert.Equal(HttpStatusCode.Conflict, (await Send(fixture.Clients["outbound1"], HttpMethod.Post, "/api/outbounds", changed, key)).StatusCode);
        var status = await Json(await fixture.Clients["outbound1"].GetAsync($"/api/submissions/status?operation=OUTBOUND:create&key={key}"));
        Assert.Equal("SUCCEEDED", status.GetProperty("status").GetString());
        var other = await Json(await fixture.Clients["driver1"].GetAsync($"/api/submissions/status?operation=OUTBOUND:create&key={key}"));
        Assert.Equal("NOT_SUBMITTED", other.GetProperty("status").GetString());
    }
    [Fact]
    public async Task Failed_submission_does_not_permanently_reserve_its_idempotency_key()
    {
        var (_, vegetable) = await fixture.Stock(0, 1); var key = Guid.NewGuid().ToString("N");
        var request = new DraftInput(new(Day, [new(vegetable, 2)], CustomerId: fixture.Customer), true);
        Assert.Equal(HttpStatusCode.Conflict, (await Send(fixture.Clients["outbound1"], HttpMethod.Post, "/api/outbounds", request, key)).StatusCode);
        var failedStatus = await Json(await fixture.Clients["outbound1"].GetAsync($"/api/submissions/status?operation=OUTBOUND:create&key={key}"));
        Assert.Equal("FAILED", failedStatus.GetProperty("status").GetString());
        await fixture.Create("admin", "stock-documents", new(Day, [new(vegetable, 2)], Source: "EXTERNAL"));
        Assert.True((await Send(fixture.Clients["outbound1"], HttpMethod.Post, "/api/outbounds", request, key)).IsSuccessStatusCode);
        Assert.Equal(1, await fixture.Balance(vegetable));
    }
    [Fact]
    public async Task Reverse_and_correct_preserve_audit_and_refuse_active_dependencies()
    {
        var (_, vegetable) = await fixture.Stock(0, 30);
        var outbound = await fixture.Create("outbound1", "outbounds", new(Day, [new(vegetable, 10)], CustomerId: fixture.Customer));
        var correction = await Send(fixture.Clients["admin"], HttpMethod.Post, $"/api/admin/documents/outbounds/{outbound}/correct", new CorrectInput("数量录入错误", new(Day, [new(vegetable, 8)], CustomerId: fixture.Customer)));
        correction.EnsureSuccessStatusCode(); Assert.Equal(22, await fixture.Balance(vegetable));
        var replacement = (await Json(correction)).GetProperty("id").GetInt64(); Assert.NotEqual(outbound, replacement);
        var old = await Json(await fixture.Clients["admin"].GetAsync($"/api/outbounds/{outbound}"));
        Assert.Equal("REVERSED", old.GetProperty("document").GetProperty("status").GetString());
        var reverse = await Send(fixture.Clients["admin"], HttpMethod.Post, $"/api/admin/documents/outbounds/{replacement}/reverse", new ReverseInput("取消发货"));
        reverse.EnsureSuccessStatusCode(); Assert.Equal(30, await fixture.Balance(vegetable));
        var (packaging, output) = await fixture.Stock(); var batch = await fixture.Dispatch(packaging);
        var work = await fixture.Create("worker1", "work-records", new(Day, [new(packaging, 20)], batch, Vegetables: [new(output, 20)]));
        var recovery = await fixture.Create("driver1", "recoveries", new(Day, [new(packaging, 80)], batch, Vegetables: [new(output, 20)], Mode: "FINAL", ConfirmFinal: true));
        var blocked = await Send(fixture.Clients["admin"], HttpMethod.Post, $"/api/admin/documents/work-records/{work}/reverse", new ReverseInput("重录"));
        Assert.Equal(HttpStatusCode.Conflict, blocked.StatusCode); Assert.Contains("DEPENDENCY_BLOCKS_REVERSAL", await blocked.Content.ReadAsStringAsync());
        (await Send(fixture.Clients["admin"], HttpMethod.Post, $"/api/admin/documents/recoveries/{recovery}/reverse", new ReverseInput("回收重录"))).EnsureSuccessStatusCode();
        (await Send(fixture.Clients["admin"], HttpMethod.Post, $"/api/admin/documents/work-records/{work}/reverse", new ReverseInput("作业重录"))).EnsureSuccessStatusCode();
        Assert.Empty(await new ReportRepository(fixture.Database).Reconcile());
        await using var connection = await fixture.Database.Open();
        var audits = await aspnetapp.Infrastructure.Database.Query(connection, null, "SELECT Id FROM AuditLogs WHERE Action='CORRECT' AND EntityId=@id", ("id", outbound));
        Assert.Single(audits);
    }
    [Theory]
    [InlineData("箱", 1.5, false)]
    [InlineData("公斤", 1.123, true)]
    [InlineData("公斤", 1.1234, false)]

    [InlineData("箱", 0, false)]
    [InlineData("箱", -1, false)]
    public async Task Quantity_units_and_precision_are_validated(string unit, decimal quantity, bool expected)
    {
        var vegetable = await fixture.Archive("vegetable-types", unit);
        var response = await Send(fixture.Clients["admin"], HttpMethod.Post, "/api/stock-documents", new DraftInput(new(Day, [new(vegetable, quantity)]), true));
        Assert.Equal(expected, response.IsSuccessStatusCode);
        if (!expected)
        {
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        }
    }
    [Fact]
    public async Task Quantity_strings_cannot_have_more_than_three_fraction_digits_even_when_zero()
    {
        var vegetable = await fixture.Archive("vegetable-types", "公斤");
        var input = new DraftInput(new(Day, [new(vegetable, 1.0000m)]), true);
        var response = await Send(fixture.Clients["admin"], HttpMethod.Post, "/api/stock-documents", input);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(0, await fixture.Balance(vegetable));
    }
    [Fact]
    public async Task Draft_edit_does_not_change_stock_and_post_requires_current_version()
    {
        var (_, vegetable) = await fixture.Stock(0, 10);
        var input = new DocumentInput(Day, [new(vegetable, 2)], CustomerId: fixture.Customer);
        var draft = await fixture.Create("outbound1", "outbounds", input, post: false); Assert.Equal(10, await fixture.Balance(vegetable));
        var edit = await Send(fixture.Clients["outbound1"], HttpMethod.Put, $"/api/outbounds/{draft}?version=1", input with { Items = [new(vegetable, 3)] }); edit.EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Conflict, (await Send(fixture.Clients["outbound1"], HttpMethod.Post, $"/api/outbounds/{draft}/post", new PostInput(1))).StatusCode);
        (await Send(fixture.Clients["outbound1"], HttpMethod.Post, $"/api/outbounds/{draft}/post", new PostInput(2))).EnsureSuccessStatusCode(); Assert.Equal(7, await fixture.Balance(vegetable));
        Assert.Equal(HttpStatusCode.Conflict, (await Send(fixture.Clients["outbound1"], HttpMethod.Put, $"/api/outbounds/{draft}?version=3", input)).StatusCode);
    }
    [Fact]
    public async Task Monthly_loss_uses_closing_month_dispatched_denominator_and_excel_is_safe()
    {
        var (packaging, vegetable) = await fixture.Stock(); var batch = await fixture.Dispatch(packaging);
        await fixture.Create("worker1", "work-records", new(new(2026, 9, 30), [new(packaging, 70)], batch, Vegetables: [new(vegetable, 70)]));
        await fixture.Create("driver1", "recoveries", new(Day, [new(packaging, 25)], batch, Vegetables: [new(vegetable, 70)], Mode: "FINAL", ConfirmFinal: true, LossReason: "损坏"));
        var loss = await Json(await fixture.Clients["admin"].GetAsync($"/api/reports/monthly-loss?from=2026-10-01&to=2026-10-31&itemId={packaging}"));
        var row = loss.GetProperty("items")[0]; Assert.Equal("100", row.GetProperty("dispatched").GetString()); Assert.Equal("0.05", row.GetProperty("lossRate").GetString());
        var lossExport = await fixture.Clients["admin"].GetAsync($"/api/reports/monthly-loss/excel?itemId={packaging}");
        lossExport.EnsureSuccessStatusCode();
        using var lossStream = new MemoryStream(await lossExport.Content.ReadAsByteArrayAsync());
        using var lossWorkbook = new XLWorkbook(lossStream);
        Assert.Equal(5, lossWorkbook.Worksheet("分单位合计").Cell(2, 2).GetDouble());
        Assert.Equal(100, lossWorkbook.Worksheet("分单位合计").Cell(2, 3).GetDouble());
        Assert.Equal(0.05, lossWorkbook.Worksheet("分单位合计").Cell(2, 4).GetDouble());
        var september = await Json(await fixture.Clients["admin"].GetAsync($"/api/reports/monthly-loss?from=2026-09-01&to=2026-09-30&itemId={packaging}")); Assert.Equal(0, september.GetProperty("items").GetArrayLength());
        await fixture.Create("outbound1", "outbounds", new(Day, [new(vegetable, 10)], CustomerId: fixture.Customer, Mode: "DIRECT", Remark: "=HYPERLINK(恶意)"));
        var response = await fixture.Clients["admin"].GetAsync($"/api/reports/vegetable-outbound/excel?itemId={vegetable}&pageSize=1"); response.EnsureSuccessStatusCode();
        Assert.Equal("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", response.Content.Headers.ContentType?.MediaType);
        using var stream = new MemoryStream(await response.Content.ReadAsByteArrayAsync()); using var workbook = new XLWorkbook(stream);
        var sheet = workbook.Worksheet("明细"); var headers = sheet.Row(1).CellsUsed().ToDictionary(cell => cell.GetString(), cell => cell.Address.ColumnNumber);
        Assert.Equal(10, sheet.Cell(2, headers["实际出库量"]).GetDouble()); Assert.Equal(-10, sheet.Cell(2, headers["展示数量"]).GetDouble());
        Assert.False(sheet.Cell(2, headers["备注"]).HasFormula); Assert.True(sheet.Cell(2, headers["备注"]).Style.IncludeQuotePrefix);
    }
}
