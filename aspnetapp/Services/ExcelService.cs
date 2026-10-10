using aspnetapp.Domain;
using aspnetapp.Infrastructure;
using ClosedXML.Excel;
using System.Globalization;

namespace aspnetapp.Services;

public sealed class ExcelService
{
    private static readonly Dictionary<string, string> Headers = new()
    {
        ["Id"] = "记录编号",
        ["Number"] = "单号",
        ["BusinessDate"] = "业务日期",
        ["Name"] = "品类",
        ["Unit"] = "单位",
        ["Specification"] = "规格",
        ["GrowerName"] = "棚户",
        ["DriverName"] = "司机",
        ["CustomerName"] = "客户",
        ["Domain"] = "库存域",
        ["Event"] = "事件",
        ["Quantity"] = "有符号变化量",
        ["ActualQuantity"] = "实际出库量",
        ["DisplayQuantity"] = "展示数量",
        ["Mode"] = "出库模式",
        ["Remark"] = "备注",
        ["Source"] = "来源",
        ["Kind"] = "单据类型",
        ["Dispatched"] = "下发量",
        ["Consumed"] = "消耗量",
        ["Recovered"] = "回收量",
        ["Lost"] = "已确认损耗",
        ["Outstanding"] = "在外余额",
        ["DaysOutside"] = "已在外天数",
        ["Month"] = "损耗确认月份",
        ["LossRate"] = "损耗率",
        ["Output"] = "现场产出",
        ["Received"] = "实际运回",
        ["Difference"] = "产出/实收差异",
        ["Status"] = "单据状态",
        ["ReversalOf"] = "逆转原流水",
        ["CreatedAt"] = "UTC创建时间"
    };
    private static string SafeText(string value) => value.Length > 0 && "=+-@".Contains(value[0]) ? "'" + value : value;
    public byte[] Export(string name, List<Row> rows, PageQuery filter)
    {
        using var workbook = new XLWorkbook();
        var metadata = workbook.Worksheets.Add("统计口径");
        metadata.Cell(1, 1).Value = "报表"; metadata.Cell(1, 2).Value = name;
        metadata.Cell(2, 1).Value = "生成时间（UTC）"; metadata.Cell(2, 2).Value = DateTime.UtcNow.ToString("O");
        metadata.Cell(3, 1).Value = "筛选范围"; metadata.Cell(3, 2).Value = JsonSettings.Serialize(filter);
        metadata.Cell(4, 1).Value = "数量口径"; metadata.Cell(4, 2).Value = "DIRECT 展示量为负，实际出库量始终为正；单位不同不得相加。损耗分母为当期最终关闭批次下发量。";
        var sheet = workbook.Worksheets.Add("明细");
        if (rows.Count > 0)
        {
            var keys = rows[0].Output().Keys.ToArray();
            var originalKeys = keys.Select(key => Headers.Keys.FirstOrDefault(header => string.Equals(header, key, StringComparison.OrdinalIgnoreCase)) ?? key).ToArray();
            for (var column = 0; column < keys.Length; column++)
            {
                sheet.Cell(1, column + 1).Value = Headers.GetValueOrDefault(originalKeys[column], keys[column]);
            }

            for (var rowIndex = 0; rowIndex < rows.Count; rowIndex++)
            {
                var values = rows[rowIndex].Output();
                for (var column = 0; column < keys.Length; column++)
                {
                    var cell = sheet.Cell(rowIndex + 2, column + 1);
                    var value = values[keys[column]];
                    var numeric = keys[column] is "quantity" or "actualQuantity" or "displayQuantity" or "dispatched" or "consumed" or "recovered" or "lost" or "outstanding" or "output" or "received" or "difference" or "lossRate";
                    if (numeric && decimal.TryParse(Convert.ToString(value, CultureInfo.InvariantCulture), NumberStyles.Number, CultureInfo.InvariantCulture, out var quantity))
                    {
                        cell.Value = (double)quantity;
                    }
                    else if (value is DateTime date)
                    {
                        cell.Value = date.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture);
                    }
                    else
                    {
                        cell.Value = SafeText(Convert.ToString(value, CultureInfo.InvariantCulture) ?? (keys[column] == "lossRate" ? "—" : ""));
                    }
                }
            }
            sheet.Range(1, 1, rows.Count + 1, keys.Length).SetAutoFilter();
        }
        else
        {
            sheet.Cell(1, 1).Value = "当前筛选范围无记录";
        }

        sheet.SheetView.FreezeRows(1);
        sheet.Row(1).Style.Font.Bold = true;
        sheet.Columns().Width = 22;
        metadata.Columns().Width = 35;
        // 单位分别统计，展示符号不参与实物合计。
        var summaries = workbook.Worksheets.Add("分单位合计");
        summaries.Cell(1, 1).Value = "单位"; summaries.Cell(1, 2).Value = "实际出库合计"; summaries.Cell(1, 3).Value = "展示数量合计";
        var groups = rows.Where(row => row.Output().ContainsKey("actualQuantity")).GroupBy(row => row.Text("Unit"));
        var summaryRow = 2;
        foreach (var group in groups)
        {
            summaries.Cell(summaryRow, 1).Value = SafeText(group.Key);
            summaries.Cell(summaryRow, 2).Value = (double)group.Sum(row => row.Quantity("ActualQuantity"));
            summaries.Cell(summaryRow, 3).Value = (double)group.Sum(row => row.Quantity("DisplayQuantity"));
            summaryRow++;
        }
        if (name == "monthly-loss")
        {
            summaries.Clear();
            summaries.Cell(1, 1).Value = "单位";
            summaries.Cell(1, 2).Value = "已确认损耗合计";
            summaries.Cell(1, 3).Value = "最终关闭批次下发合计";
            summaries.Cell(1, 4).Value = "期间损耗率";
            summaryRow = 2;
            foreach (var group in rows.GroupBy(row => row.Text("Unit")))
            {
                var totalLoss = group.Sum(row => row.Quantity("Lost"));
                var totalDispatched = group.Sum(row => row.Quantity("Dispatched"));
                summaries.Cell(summaryRow, 1).Value = SafeText(group.Key);
                summaries.Cell(summaryRow, 2).Value = (double)totalLoss;
                summaries.Cell(summaryRow, 3).Value = (double)totalDispatched;
                if (totalDispatched == 0)
                {
                    summaries.Cell(summaryRow, 4).Value = "—";
                }
                else
                {
                    summaries.Cell(summaryRow, 4).Value = (double)(totalLoss / totalDispatched);
                }

                summaryRow++;
            }
        }
        summaries.SheetView.FreezeRows(1);
        summaries.Columns().Width = 25;
        using var stream = new MemoryStream();
        workbook.SaveAs(stream);
        return stream.ToArray();
    }
}
