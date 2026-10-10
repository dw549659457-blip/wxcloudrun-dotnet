using System.Net;
using aspnetapp.Domain;
using aspnetapp.Repositories;
using ClosedXML.Excel;
using Xunit;
using static Business.Tests.TestFixture;

namespace Business.Tests;

public sealed class AdditionalTests(TestFixture fixture) : IClassFixture<TestFixture>
{
    private static readonly DateOnly Day = new(2026, 10, 2);
    [Fact]
    public async Task Every_report_has_real_rows_or_empty_results_and_exports_all_filtered_pages()
    {
        var (_, vegetable) = await fixture.Stock(0, 30);
        await fixture.Create("outbound1", "outbounds", new(Day, [new(vegetable, 2)], CustomerId: fixture.Customer));
        await fixture.Create("outbound1", "outbounds", new(Day, [new(vegetable, 3)], CustomerId: fixture.Customer, Mode: "DIRECT", Remark: "外来菜"));
        foreach (var report in ReportRepository.Names)
        {
            var response = await fixture.Clients["admin"].GetAsync($"/api/reports/{report}"); response.EnsureSuccessStatusCode();
            Assert.True((await Json(response)).TryGetProperty("items", out _));
        }
        var export = await fixture.Clients["admin"].GetAsync($"/api/reports/vegetable-outbound/excel?itemId={vegetable}&pageSize=1"); export.EnsureSuccessStatusCode();
        using var stream = new MemoryStream(await export.Content.ReadAsByteArrayAsync()); using var workbook = new XLWorkbook(stream);
        Assert.Equal(3, workbook.Worksheet("明细").LastRowUsed()!.RowNumber());
        Assert.Equal(5, workbook.Worksheet("分单位合计").Cell(2, 2).GetDouble());
        Assert.Equal(-1, workbook.Worksheet("分单位合计").Cell(2, 3).GetDouble());
    }
    [Fact]
    public async Task Failed_correction_rolls_back_reversal_and_retains_original_posted_document()
    {
        var (_, vegetable) = await fixture.Stock(0, 10);
        var id = await fixture.Create("outbound1", "outbounds", new(Day, [new(vegetable, 4)], CustomerId: fixture.Customer));
        var result = await Send(fixture.Clients["admin"], HttpMethod.Post, $"/api/admin/documents/outbounds/{id}/correct", new CorrectInput("重新核对", new(Day, [new(vegetable, 11)], CustomerId: fixture.Customer)));
        Assert.Equal(HttpStatusCode.Conflict, result.StatusCode);
        Assert.Equal(6, await fixture.Balance(vegetable));
        var original = await Json(await fixture.Clients["admin"].GetAsync($"/api/outbounds/{id}")); Assert.Equal("POSTED", original.GetProperty("document").GetProperty("status").GetString());
        Assert.Empty(await new ReportRepository(fixture.Database).Reconcile());
    }
    [Fact]
    public async Task Real_received_quantity_above_registered_output_requires_reason_and_remains_negative_difference()
    {
        var (packaging, vegetable) = await fixture.Stock(); var batch = await fixture.Dispatch(packaging);
        await fixture.Create("worker1", "work-records", new(Day, [new(packaging, 5)], batch, Vegetables: [new(vegetable, 5)]));
        var input = new DocumentInput(Day, [new(packaging, 95)], batch, Vegetables: [new(vegetable, 8)], Mode: "FINAL", ConfirmFinal: true);
        var failure = await Send(fixture.Clients["driver1"], HttpMethod.Post, "/api/recoveries", new DraftInput(input, true));
        Assert.Equal(HttpStatusCode.BadRequest, failure.StatusCode); Assert.Equal(0, await fixture.Balance(vegetable)); Assert.Equal(900, await fixture.Balance(packaging));
        await fixture.Create("driver1", "recoveries", input with { DifferenceReason = "现场少登3箱，以实物为准" });
        Assert.Equal(8, await fixture.Balance(vegetable));
        var summary = await Json(await fixture.Clients["driver1"].GetAsync($"/api/batches/{batch}/summary"));
        Assert.Equal("-3", summary.GetProperty("vegetables")[0].GetProperty("difference").GetString());
    }
    [Fact]
    public async Task Historical_names_and_units_survive_archive_renaming_and_units_cannot_be_changed()
    {
        var vegetable = await fixture.Archive("vegetable-types", "箱", "历史名称");
        await fixture.Create("admin", "stock-documents", new(Day, [new(vegetable, 10)]));
        var id = await fixture.Create("outbound1", "outbounds", new(Day, [new(vegetable, 1)], CustomerId: fixture.Customer));
        (await Send(fixture.Clients["admin"], HttpMethod.Put, $"/api/vegetable-types/{vegetable}", new ArchiveInput("新名称", "箱"))).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Conflict, (await Send(fixture.Clients["admin"], HttpMethod.Put, $"/api/vegetable-types/{vegetable}", new ArchiveInput("新名称", "公斤"))).StatusCode);
        var detail = await Json(await fixture.Clients["admin"].GetAsync($"/api/outbounds/{id}")); Assert.Equal("历史名称", detail.GetProperty("items")[0].GetProperty("itemName").GetString());
        var report = await Json(await fixture.Clients["admin"].GetAsync($"/api/reports/vegetable-inbound?itemId={vegetable}")); Assert.Equal("历史名称", report.GetProperty("items")[0].GetProperty("name").GetString());
    }
    [Fact]
    public async Task Session_and_inventory_persist_when_application_instance_is_recreated()
    {
        var (_, vegetable) = await fixture.Stock(0, 12);
        using var restarted = fixture.Factory.WithWebHostBuilder(_ => { });
        using var client = restarted.CreateClient(); client.DefaultRequestHeaders.Authorization = fixture.Clients["outbound1"].DefaultRequestHeaders.Authorization;
        (await client.GetAsync("/api/auth/me")).EnsureSuccessStatusCode();
        var result = await Json(await client.GetAsync($"/api/inventory/vegetables?itemId={vegetable}")); Assert.Equal("12", result.GetProperty("items")[0].GetProperty("quantity").GetString());
    }
    [Fact]
    public async Task Submission_idempotency_works_across_two_application_instances()
    {
        var (_, vegetable) = await fixture.Stock(0, 20);
        using var other = fixture.Factory.WithWebHostBuilder(_ => { });
        using var client = other.CreateClient(); client.DefaultRequestHeaders.Authorization = fixture.Clients["outbound1"].DefaultRequestHeaders.Authorization;
        var request = new DraftInput(new(Day, [new(vegetable, 2)], CustomerId: fixture.Customer), true); var key = Guid.NewGuid().ToString("N");
        var result = await Task.WhenAll(Send(client, HttpMethod.Post, "/api/outbounds", request, key), Send(fixture.Clients["outbound1"], HttpMethod.Post, "/api/outbounds", request, key));
        Assert.All(result, response => Assert.True(response.IsSuccessStatusCode));
        Assert.Equal((await Json(result[0])).GetProperty("id").GetInt64(), (await Json(result[1])).GetProperty("id").GetInt64()); Assert.Equal(18, await fixture.Balance(vegetable));
    }
}
