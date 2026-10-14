#!/usr/bin/env python3
"""Generate the launch preparation workbook; no business database is accessed."""
from pathlib import Path
from datetime import datetime
import xlsxwriter

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'deliverables/prelaunch-data-maintenance-1.2.2.xlsx'
OUTPUT.parent.mkdir(exist_ok=True)
wb = xlsxwriter.Workbook(OUTPUT, {'strings_to_formulas': False, 'strings_to_urls': False})
wb.set_properties({'title': '棚户记账：上线前基础数据维护指导', 'subject': '管理员建档、盘点与上线核对', 'author': '棚户记账', 'comments': '适用版本1.2.2；填写后按后台界面维护。本文件不具备自动导入功能。'})
wb.set_calc_mode('auto')
GREEN, PALE, BLUE, GOLD = '#176747', '#E9F3EC', '#165A84', '#FFF4D3'
fmt = {
    'title': wb.add_format({'font_size': 20, 'bold': True, 'font_color': 'white', 'bg_color': GREEN, 'valign': 'vcenter'}),
    'note': wb.add_format({'font_size': 11, 'font_color': '#385545', 'bg_color': PALE, 'text_wrap': True, 'valign': 'vcenter'}),
    'header': wb.add_format({'bold': True, 'font_color': 'white', 'bg_color': GREEN, 'text_wrap': True, 'valign': 'vcenter', 'border': 1, 'border_color': '#D6E5DA'}),
    'input': wb.add_format({'font_color': BLUE, 'num_format': '@', 'text_wrap': True, 'valign': 'vcenter'}),
    'number': wb.add_format({'font_color': BLUE, 'num_format': '0.###', 'valign': 'vcenter'}),
    'date': wb.add_format({'font_color': BLUE, 'num_format': 'yyyy-mm-dd', 'valign': 'vcenter'}),
    'formula': wb.add_format({'font_color': '#63532B', 'bg_color': GOLD, 'num_format': '0.###', 'text_wrap': True, 'valign': 'vcenter'}),
    'text': wb.add_format({'font_size': 11, 'text_wrap': True, 'valign': 'vcenter'}),
    'red': wb.add_format({'bg_color': '#FCE6E1', 'font_color': '#A62C21'}),
    'good': wb.add_format({'bg_color': '#DDF2E3', 'font_color': GREEN}),
    'link': wb.add_format({'font_color': GREEN, 'underline': True, 'text_wrap': True}),
}
options = wb.add_worksheet('选项')
values = {
    'yes_no': ['是', '否'],
    'maint_status': ['未开始', '准备中', '待核对', '已完成', '不适用'],
    'veg_units': ['箱', '公斤'],
    'item_kind': ['包装', '蔬菜'],
    'password_status': ['已单独设置', '保持原密码', '无需密码', '未设置'],
    'bind_status': ['已绑定', '待本人绑定', '仅网页后台'],
    'stock_action': ['首次期初入库', '核对后库存调整', '无需入账', '待核对'],
    'stock_status': ['待盘点', '待复核', '待入账', '已入账', '无需入账'],
    'cutover_action': ['上线前结清', '沿用已存在批次', '专门制定切换方案', '待核对'],
    'review_result': ['未验证', '通过', '未通过', '不适用'],
}
for col, (name, choices) in enumerate(values.items()):
    options.write(0, col, name)
    options.write_column(1, col, choices)
    letter = xlsxwriter.utility.xl_col_to_name(col)
    wb.define_name(name, f"'选项'!${letter}$2:${letter}${len(choices)+1}")
options.hide()
BASE = 'https://dotnet-4jwm-326107-6-1503430980.sh.run.tcloudbase.com/admin/'
FIRST, LAST = 5, 104  # Excel rows 6..105, 100 editable rows.


def frame(name, title, headers, widths, note, tip, route=None, rows=100):
    sheet = wb.add_worksheet(name)
    sheet.hide_gridlines(2)
    sheet.set_tab_color(GREEN)
    sheet.merge_range(0, 0, 0, len(headers)-1, title, fmt['title'])
    sheet.set_row(0, 36)
    sheet.merge_range(1, 0, 1, len(headers)-1, note, fmt['note'])
    sheet.set_row(1, 42)
    sheet.merge_range(2, 0, 2, len(headers)-1, tip, fmt['note'])
    sheet.set_row(2, 38)
    if route:
        sheet.write_url(3, 0, BASE+route, fmt['link'], '打开后台维护入口')
    for col, width in enumerate(widths):
        sheet.set_column(col, col, width, fmt['input'])
    sheet.set_row(4, 44)
    columns = [{'header': header, 'header_format': fmt['header']} for header in headers]
    sheet.add_table(4, 0, 4+rows, len(headers)-1, {'name': 'Data'+name[:2], 'style': 'Table Style Medium 4', 'columns': columns})
    for row in range(FIRST, FIRST+rows):
        for col in range(len(headers)):
            sheet.write_blank(row, col, None, fmt['input'])
    sheet.freeze_panes(FIRST, min(2, len(headers)-1))
    sheet.set_landscape()
    sheet.set_paper(8 if len(headers)>9 else 9)  # A3 for wide input forms, A4 otherwise.
    sheet.fit_to_pages(1, 0)
    sheet.repeat_rows(0, 4)
    sheet.set_margins(.3, .3, .4, .4)
    sheet.set_footer('&L棚户记账 · 基础数据维护1.2.2&R第 &P 页')
    sheet.print_area(0, 0, 4+rows, len(headers)-1)
    return sheet


def dropdown(sheet, column, name, rows=100):
    sheet.data_validation(FIRST, column, FIRST+rows-1, column, {'validate': 'list', 'source': '='+name, 'ignore_blank': True, 'error_type': 'stop', 'error_title': '请选择下拉项', 'error_message': '请从下拉列表选择，不要自行修改选项文字。'})


def length(sheet, column, maximum):
    sheet.data_validation(FIRST, column, LAST, column, {'validate': 'length', 'criteria': '<=', 'value': maximum, 'ignore_blank': True, 'error_title': '内容过长', 'error_message': f'最多{maximum}个字符。', 'error_type': 'stop'})


def status_colors(sheet, column, values=('已完成', '通过', '已入账', '可维护')):
    for word in values:
        sheet.conditional_format(FIRST, column, LAST, column, {'type': 'cell', 'criteria': 'equal to', 'value': f'"{word}"', 'format': fmt['good']})
    for word in ['待完善', '未通过']:
        sheet.conditional_format(FIRST, column, LAST, column, {'type': 'cell', 'criteria': 'equal to', 'value': f'"{word}"', 'format': fmt['red']})


intro = wb.add_worksheet('00维护指导')
intro.hide_gridlines(2)
intro.set_tab_color(GREEN)
intro.set_column('A:A', 5)
intro.set_column('B:B', 24)
intro.set_column('C:C', 40)
intro.set_column('D:D', 47)
intro.merge_range('A1:D1', '上线前，管理员应该维护哪些数据？', fmt['title'])
intro.set_row(0, 42)
intro.merge_range('A2:D2', '适用：棚户记账1.2.2｜蓝字区域供填写，浅黄色区域为自动核对｜示例仅在“10填写示例”，各填写表均为空白。', fmt['note'])
intro.set_row(1, 36)
intro.merge_range('A3:D3', '本Excel用于收集、盘点与人工维护，当前后台没有本表的批量导入入口。填好后按对应后台页面新增/编辑；库存必须通过单据确认入账。', fmt['note'])
intro.set_row(2, 44)
intro.write_row(4, 0, ['顺序', '要维护的内容', '工作表 / 后台入口', '完成标准'], fmt['header'])
intro.set_row(4, 32)
plan = [
    [1, '人员账号与岗位', '02人员账号 / 员工与身份→员工与角色', '姓名、唯一账号、本人手机号、岗位、启用状态正确。管理员/后台管理员密码单独设置，普通员工不用后台密码。'],
    [2, '棚户档案', '03棚户档案 / 基础档案→棚户档案', '每个实际合作棚户登记准确名称并启用；联系人、电话可选。棚户档案不会自动创建员工。'],
    [3, '包装档案', '04包装档案 / 基础档案→包装类型档案', '名称、库存单位必填，规格建议填清；包装数量按整数。不同规格建议用名称明确区分。'],
    [4, '蔬菜档案', '05蔬菜档案 / 基础档案→蔬菜品类档案', '单位只能“箱”或“公斤”。同名菜按箱、公斤分别记时，应分别建品类，不能自动换算或相加。'],
    [5, '客户档案', '06客户档案 / 基础档案→客户档案', '真实收货客户提前建档并启用，出库必须选择客户；联系人和电话可选。'],
    [6, '仓库期初与余额核对', '07期初盘点 / 库存入库与调整', '确定切账日期，盘点仓库实物，查询系统已有余额及历史后复核。零数量不用入库；已有账不重复做期初。'],
    [7, '未结棚户任务（如有）', '08未结任务 / 业务批次查询', '核对在外包装和未入仓蔬菜，决定结清、沿用已有批次或制定切换方案；不当作仓库期初。'],
    [8, '后台管理员权限与本人微信', '01维护清单、09上线核对', '后台管理员负责下级员工管理和审批，业务默认查询/导出；额外业务权限由管理员配置。管理员和员工用本人微信核对姓名并绑定。'],
]
for row, item in enumerate(plan, 5):
    intro.write_row(row, 0, item, fmt['text'])
    intro.set_row(row, 62)
intro.merge_range('A15:D15', '建议顺序：先填清单和人员 → 棚户/包装/蔬菜/客户 → 盘点并复核 → 后台维护 → 微信本人绑定 → 上线核对。', fmt['note'])
intro.set_row(14, 36)
intro.merge_range('A17:D17', '特别注意：本表不收集真实密码、数据库密码或AppSecret；“后台密码设置”仅记录是否已单独设置。唯一检查只覆盖本表，后台已有账号仍须核对。', fmt['note'])
intro.set_row(16, 42)
intro.merge_range('A19:D19', '期初只填仓库实际可用包装与已实收到仓蔬菜；棚户在外包装、仅装好的蔬菜不属于仓库余额。库存差额必须先核实，不靠重录期初覆盖。', fmt['note'])
intro.set_row(18, 42)
intro.write_url('B21', "internal:'01维护清单'!A1", fmt['link'], '从维护清单开始')
intro.write_url('C21', BASE, fmt['link'], '打开管理后台')
intro.write_url('D21', 'https://github.com/dw549659457-blip/wxcloudrun-dotnet/blob/main/docs/user-manual-1.2.2.md', fmt['link'], '查看图文使用手册')
intro.freeze_panes(5, 0)
intro.set_landscape(); intro.set_paper(9); intro.fit_to_pages(1, 1); intro.print_area('A1:D21')

checklist = frame('01维护清单', '管理员上线前维护清单', ['顺序', '维护项目', '是否需要', '后台入口', '具体要做什么', '完成标准', '负责人', '计划完成日期', '状态', '备注'], [7,22,18,30,50,48,16,17,16,35], '填负责人、计划日期与状态。业务数据由管理员维护；技术部署条件由维护人员确认。', '不要把示例姓名、示例数量或旧测试单直接当作真实业务。角色按实际使用配置，不强制每个岗位对应不同的人。', rows=14)
items = [
    ['1','原管理员账号','必需','员工与身份→员工与角色','核对原账号、本人姓名、手机号及ADMIN，保留启用；编辑不换密码则留空。','至少1个启用管理员；本人手机号正确，可登录网页。'],
    ['2','司机/装菜/出库人员','使用对应流程时必需','员工与身份→员工与角色','按本人填唯一账号和手机号，勾选实际岗位，启用；一人多岗可多选。','对应岗位人员准备好，能够本人确认；不共用账号。'],
    ['3','后台管理员账号','需要后台管理员时','员工与身份→员工与角色','由最高管理员设置独立密码；负责下级人员管理及审批，业务默认查询和导出；使用网页后台。','后台管理员可登录网页、查询和导出。'],
    ['4','棚户','使用派发/装菜/回收时','基础档案→棚户档案','准确名称，按需填联系人/电话并启用。','真实合作棚户可被司机选择。'],
    ['5','包装类型','使用包装流转时','基础档案→包装类型档案','名称、单位、规格核实后启用。','规格明确、数量单位一致。'],
    ['6','蔬菜品类','使用菜产出/入库/出库时','基础档案→蔬菜品类档案','名称、单位箱或公斤；不同计量口径分别建档。','出库品类已建档，箱/公斤不混用。'],
    ['7','客户','使用出库时','基础档案→客户档案','真实客户名称、可选联系方式、启用。','出库时可选择正确客户。'],
    ['8','单位和规格','必需','包装类型/蔬菜品类档案','业务发生前确定；已使用单位不能随意改，必要时新建品类。','与员工实物计数口径一致。'],
    ['9','仓库切账盘点','必需','库存入库与调整；仓库概览','填实盘与已有系统余额，复核历史和差额。','单据入账后数量与实物一致；不重复入库。'],
    ['10','未结任务','存在时必需','业务批次查询','逐户核对司机、包装与蔬菜，确定切换方案。','在外与仓库分别清楚，不重复造历史业务。'],
    ['11','后台管理员业务权限','使用后台管理员时','后台管理员权限配置','默认查/导出；确需其他权限时选模块，填写调整原因，核对保存。','配置适用于全部后台管理员；同级/上级后台账号及审计仍仅管理员；后台管理员可维护下级员工和审批。'],
    ['12','本人微信绑定','小程序人员必需','小程序开始使用；开通协助审批','本人核实手机号与姓名，或管理员核实协助后由本人确认。','各岗位实际人员能进入正确工作台。'],
    ['13','现有数据核对','已有业务库必需','全量业务单据；库存；报表','区分真实与测试记录，管理员按业务依赖核实处理；保留已确认历史。','不得为了上线清空库、直接改余额或重跑首次初始化。'],
    ['14','最终复核与通知','上线前必需','09上线核对；管理审计','核对账号、库存、权限、动态、模板及数据维护记录。','负责人确认，问题有明确处理安排。'],
]
for row, item in enumerate(items, FIRST):
    checklist.write_row(row, 0, item, fmt['text'])
    checklist.set_row(row, 66)
dropdown(checklist,8,'maint_status',14)
checklist.set_column(7,7,17,fmt['date'])
for row in range(FIRST,FIRST+14): checklist.write_blank(row,7,None,fmt['date'])

users = frame('02人员账号', '人员账号与岗位填写表（100行）', ['姓名*','唯一账号*','本人手机号*','管理员','后台管理员','司机','装菜人员','出库员','启用*','后台密码设置','微信绑定核对','后台维护状态','备注','填写检查（自动）'], [18,23,19,9,8,8,11,9,9,21,21,17,36,19], '对应：员工与身份→员工与角色。至少一个岗位选“是”；其余选“否”。手机号必须是本人11位大陆手机号。', '普通司机/装菜/出库员不用后台密码。新管理员、后台管理员密码12—128字符；密码只在后台设置，不填写本表。编辑原管理员可保持原密码。', 'users')
users.freeze_panes(FIRST,3)
length(users,0,80)
users.data_validation('B6:B105', {'validate':'custom','value':'=OR(B6="",AND(LEN(B6)<=80,COUNTIF($B$6:$B$105,B6)=1))','ignore_blank':True,'error_type':'stop','error_title':'账号重复或过长','error_message':'本表账号不得重复，长度最多80字符。仍需核对后台已有账号。'})
users.data_validation('C6:C105', {'validate':'custom','value':'=OR(C6="",AND(ISTEXT(C6),LEN(C6)=11,SUMPRODUCT(--ISNUMBER(FIND(MID(C6,ROW($1:$11),1),"0123456789")))=11,LEFT(C6,1)="1",ISNUMBER(FIND(MID(C6,2,1),"3456789")),COUNTIF($C$6:$C$105,C6)=1))','ignore_blank':True,'error_type':'stop','error_title':'手机号不正确或重复','error_message':'填本人的11位大陆手机号，文本格式，不能与本表其他用户重复。'})
for col in range(3,9): dropdown(users,col,'yes_no')
dropdown(users,9,'password_status'); dropdown(users,10,'bind_status'); dropdown(users,11,'maint_status')
for row in range(FIRST,LAST+1):
    n=row+1
    formula=f'=IF(COUNTA(A{n}:C{n})=0,"",IF(OR(A{n}="",B{n}="",NOT(AND(ISTEXT(C{n}),LEN(C{n})=11,SUMPRODUCT(--ISNUMBER(FIND(MID(C{n},ROW($1:$11),1),"0123456789")))=11,LEFT(C{n},1)="1",ISNUMBER(FIND(MID(C{n},2,1),"3456789")))),COUNTIF(D{n}:H{n},"是")=0,I{n}="",AND(OR(D{n}="是",E{n}="是"),NOT(OR(J{n}="已单独设置",J{n}="保持原密码"))),COUNTIF($B$6:$B$105,B{n})>1,COUNTIF($C$6:$C$105,C{n})>1),"待完善","可维护"))'
    users.write_formula(row,13,formula,fmt['formula'],'')
status_colors(users,13)

for name,title,route in [('03棚户档案','棚户档案填写表','growers'),('06客户档案','客户档案填写表','customers')]:
    sheet=frame(name,title+'（100行）',['名称*','联系人（可选）','联系方式（可选）','启用*','后台维护状态','备注'],[28,20,23,11,17,48], '对应：基础档案→'+('棚户档案' if route=='growers' else '客户档案')+'。名称必填，联系人和联系方式可选。', '这里的联系方式不用于员工微信绑定，也不会创建员工。员工应在“02人员账号”另行登记。', 'archives/'+route)
    for col,limit in [(0,100),(1,80),(2,32)]: length(sheet,col,limit)
    dropdown(sheet,3,'yes_no'); dropdown(sheet,4,'maint_status'); status_colors(sheet,4)

for name,title,route in [('04包装档案','包装档案填写表','packaging-types'),('05蔬菜档案','蔬菜档案填写表','vegetable-types')]:
    is_veg=route=='vegetable-types'
    sheet=frame(name,title+'（100行）',['名称*','库存单位*','规格（可选）','联系人（可选）','联系方式（可选）','启用*','后台维护状态','备注'],[26,15,32,18,23,11,17,45], '对应：基础档案→'+('蔬菜品类档案' if is_veg else '包装类型档案')+'。名称及库存单位必填；规格建议写清实际大小/重量口径。', '蔬菜单位只能箱/公斤，箱数为整数，公斤最多3位小数；同名按两种单位记账时分别建品类。' if is_veg else '包装单位可填写个、筐、袋等实际计数单位，数量用整数。不同规格建议在名称中明确区分。已使用品类不能随意改单位。', 'archives/'+route)
    for col,limit in [(0,100),(2,200),(3,80),(4,32)]: length(sheet,col,limit)
    if is_veg: dropdown(sheet,1,'veg_units')
    else: length(sheet,1,16)
    dropdown(sheet,5,'yes_no'); dropdown(sheet,6,'maint_status'); status_colors(sheet,6)

stock=frame('07期初盘点','仓库盘点、已有余额与入账复核（100行）',['切账日期*','品类类别*','品类名称*','规格核对','库存单位*','仓库实盘数量*','系统已有仓库余额*','差额（自动）','处理方式*','核对说明/调整原因','复核人*','后台入账单号','执行状态','备注'],[16,14,24,25,14,19,23,18,23,44,17,40,17,35], '只盘仓库内实际可用包装、已实收到仓蔬菜；不包含棚户在外包装和装菜未入仓产出。差额=实盘-已有仓库余额。', '空库且从未入账才按首次期初；已有历史须先核实，用有原因的库存调整处理差额。差额0不用入账；差额负数做出向调整时仍填正数绝对值。', 'stock')
stock.data_validation('A6:A105',{'validate':'date','criteria':'between','minimum':datetime(2000,1,1),'maximum':datetime(2100,12,31),'ignore_blank':True,'error_type':'stop','input_message':'填真实切账业务日期，不自动用今天日期。'})
stock.set_column(0,0,16,fmt['date'])
for row in range(FIRST,LAST+1): stock.write_blank(row,0,None,fmt['date'])
dropdown(stock,1,'item_kind')
length(stock,2,100); length(stock,3,200); length(stock,4,16)
for col in (5,6):
    letter=xlsxwriter.utility.xl_col_to_name(col)
    stock.set_column(col,col,23,fmt['number'])
    for row in range(FIRST,LAST+1): stock.write_blank(row,col,None,fmt['number'])
    stock.data_validation(FIRST,col,LAST,col,{'validate':'custom','value':f'=OR({letter}6="",AND(ISNUMBER({letter}6),{letter}6>=0,IF(OR($B6="包装",$E6="箱"),{letter}6=INT({letter}6),ROUND({letter}6,3)={letter}6)))','ignore_blank':True,'error_type':'stop','error_title':'数量格式不正确','error_message':'盘点可填0；包装/箱用整数，公斤最多3位小数。不能填负数。'})
for row in range(FIRST,LAST+1):
    n=row+1
    stock.write_formula(row,7,f'=IF(COUNT(F{n}:G{n})<2,"",ROUND(F{n}-G{n},3))',fmt['formula'],'')
dropdown(stock,8,'stock_action'); dropdown(stock,12,'stock_status'); status_colors(stock,12)
stock.conditional_format('A6:N105',{'type':'formula','criteria':'=AND($C6<>"",$I6="首次期初入库",$G6>0)','format':fmt['red']})
stock.conditional_format('H6:H105',{'type':'formula','criteria':'=AND(ISNUMBER($H6),$H6<>0)','format':fmt['red']})

transit=frame('08未结任务','上线切换时，未结棚户任务核对（有在途任务才填）',['棚户','原司机','原派发日期','包装品类','单位','原累计下发','已累计消耗','已累计回收','在外实有待回收','未入仓蔬菜情况','原系统批次/单号','切换处理方案','负责人','核对状态','备注'],[22,18,17,23,12,19,19,19,23,45,42,29,17,17,44], '适用于上线切换时仍有棚户包装未回、装菜未运到仓的情况。逐项填实物和原账，不与仓库余额混合。', '新系统若没有这些原任务，不要直接当仓库期初，也不要凭本表重放历史派发/装菜/回收，以免重复扣库存。由管理员和维护人员先确认切换方案。', 'batches')
transit.set_column(2,2,17,fmt['date'])
for row in range(FIRST,LAST+1): transit.write_blank(row,2,None,fmt['date'])
transit.data_validation('C6:C105',{'validate':'date','criteria':'between','minimum':datetime(2000,1,1),'maximum':datetime(2100,12,31),'ignore_blank':True})
for col in range(5,9):
    transit.set_column(col,col,22,fmt['number'])
    for row in range(FIRST,LAST+1): transit.write_blank(row,col,None,fmt['number'])
    transit.data_validation(FIRST,col,LAST,col,{'validate':'integer','criteria':'>=','value':0,'ignore_blank':True,'error_type':'stop','error_message':'包装数量按非负整数核对。'})
dropdown(transit,11,'cutover_action'); dropdown(transit,13,'maint_status')

review=frame('09上线核对','上线前由业务管理员与维护人员一起确认',['序号','核对项目','责任人类别','实际要验证什么','通过标准','负责人','核对结果','问题/处理安排'],[8,26,18,58,54,18,17,42], '这里只记录结果，不填写数据库密码或微信密钥。使用实际业务人员微信和实际部署版本核对。', '草稿不改变库存；正式入账才产生动态。数量和单位分别核对。试用示例不得混作真实业务库存。',rows=12)
reviews=[
    ['1','原管理员可用','业务管理员','登录后台，核对姓名、启用、手机号与管理员岗位。','保留至少1个有效管理员，原业务账号不重建。'],
    ['2','基础档案已完成','业务管理员','核对棚户/包装/菜/客户名称、单位、规格和启用。','实际使用对象可以在小程序选择；无同名规格混淆。'],
    ['3','人员与本人手机号','业务管理员+员工','检查每个账号、手机号唯一，岗位准确；本人微信确认姓名。','实际用户可进入正确岗位；不借用其他人账号。'],
    ['4','仓库盘点与期初','业务管理员+后台管理员','实盘与系统余额复核，核实历史单据；按确认后的方式入账。','仓库实物与系统一致，零数量不入账，不重复期初。'],
    ['5','未结任务处理','业务管理员+维护人员','如有，核对在外包装/未入仓菜及原批次，确认切换方案。','仓库与在外分开清楚，旧任务不重复造单。'],
    ['6','后台管理员查询与导出','业务管理员+后台管理员','后台管理员登录网页，筛选报表、导出；额外业务权限核对。','默认查询/导出，其他权限按配置；同级/上级后台账号和审计只限管理员；下级员工与审批可由后台管理员维护。'],
    ['7','司机/装菜/出库流程','实际岗位员工','在指定测试安排或真实首笔业务中核对任务、数量、日期和客户。','装菜产出不提前入仓；实收才入仓；出库填正数。'],
    ['8','操作留痕','业务管理员','管理审计查询后台维护和查询记录；库存流水能追溯单号。','修改、查询、删除及失败操作能按人/时间/请求ID查到。'],
    ['9','云服务与数据库升级','维护人员','确认现有服务新版部署正常，已有业务库005/006已正确升级。','记账、权限、动态功能可用；已有库不重复首次初始化。'],
    ['10','微信身份与调用','维护人员+员工','确认AppID与云环境关联、登录及手机号资格；必要时用本人协助审批。','真实微信可进入；密钥只在服务端，未填入本表。'],
    ['11','库存动态与提醒','业务管理员+维护人员','管理员查动态，主动订阅模板74963，确认通知与点击明细。','页面显示约5秒刷新；一次订阅用于下一次变动，真实微信通知已验收。'],
    ['12','正式发布与审核访问','管理员+小程序维护人员','核对实际上传工程与版本、审核测试访问安排；正式提醒state用formal。','提交的是验收包，审核可访问对应身份；正式跳转正确。'],
]
for row,item in enumerate(reviews,FIRST):
    review.write_row(row,0,item,fmt['text']); review.set_row(row,74)
dropdown(review,6,'review_result',12); status_colors(review,6)

examples=frame('10填写示例','填写示例与字段口径（仅参考，勿直接录入）',['项目','示例填写','应当怎么理解','维护入口/注意事项'],[23,47,58,53], '示例不属于待上线数据。人员手机号用说明文字占位，实际必须填本人手机号。', '普通员工不设置网页密码；管理员/后台管理员密码在后台单独设置。以下期初数仅演示，不要求在已有库重复录入。',rows=14)
example_rows=[
    ['管理员','已有admin账号；本人手机号；管理员=是','编辑原管理员，不新建重复账号。编辑密码框留空可保持原密码。','员工与角色；改资料后重新登录，再本人微信绑定。'],
    ['司机','张师傅；driver_zhang；填本人手机号；司机=是','其余岗位按职责选是/否；可兼任，但仍是本人账号。','小程序派发、回收本人任务。'],
    ['装菜人员','王阿姨；worker_wang；填本人手机号；装菜人员=是','登记本次消耗与产出，产出不算已经入仓。','小程序装菜登记。'],
    ['出库员','赵师傅；outbound_zhao；填本人手机号；出库员=是','选择真实客户，实际出库填正数。','小程序正常/手工出库。'],
    ['后台管理员','陈女士；accountant_chen；后台管理员=是；密码已单独设置','使用网页；下级人员管理与审批、业务默认查询/导出；使用网页后台。','员工与角色、后台管理员权限配置。'],
    ['棚户','王家棚户；启用=是；联系人按需填','一户一个明确档案；棚户联系人手机号不代替员工手机号。','基础档案→棚户档案。'],
    ['包装','泡沫箱-大号；单位个；规格60×40cm；启用=是','名称区分规格；包装数量用整数。','基础档案→包装类型档案。'],
    ['蔬菜（箱）','白菜-箱装；单位箱；规格按实际；启用=是','每箱规格按实际，箱数用整数。','基础档案→蔬菜品类档案。'],
    ['蔬菜（公斤）','白菜-散装；单位公斤；启用=是','公斤可小数；与箱装分别记账，不自动换算。','基础档案→蔬菜品类档案。'],
    ['客户','东村蔬菜配送中心；联系人和电话按需填','出库实际接收方；无需为客户创建员工登录。','基础档案→客户档案。'],
    ['首次空库包装','实盘1000个，系统0个，已确认从未入账','首次期初入库1000个；已有账请先核实。','库存入库与调整，选期初，核对后确认。'],
    ['已有库存差额','实盘925个，系统900个，差额+25个','先找原因/历史单据；经确认必要时做入向调整25个，不重录925期初。','库存调整要填原因；填正数25，由方向决定增加。'],
    ['零库存或无差额','实盘0、系统0，或实盘与系统相等','无需创建0数量单据，也无需重复入账。','期初盘点状态选无需入账。'],
    ['在外包装和未入仓菜','棚户仍有30个包装、12箱菜待运回','放08未结任务核对，不加入仓库期初；实收后才回库。','先确认旧任务切换方案；已有批次按正常业务处理。'],
]
for row,item in enumerate(example_rows,FIRST):
    examples.write_row(row,0,item,fmt['text']); examples.set_row(row,69)
wb.worksheets_objs.sort(key=lambda sheet: sheet.name)
for index, sheet in enumerate(wb.worksheets_objs):
    sheet.index = index
wb.get_worksheet_by_name('00维护指导').activate()
wb.close()
print('Created', OUTPUT.name, ': 11 visible sheets, 1 hidden dropdown-options sheet; 100 blank rows per input form.')
