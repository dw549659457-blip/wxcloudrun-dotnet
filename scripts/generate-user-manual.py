#!/usr/bin/env python3
"""Build the self-contained handbook HTML from its Markdown and local PNGs.
No external requests or third-party Python dependencies are used.
"""
import base64
import html
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'docs/user-manual-1.2.1.md'
OUTPUT = ROOT / 'deliverables/user-manual-1.2.1.html'


def inline(value):
    value = html.escape(value)
    value = re.sub(r'`([^`]+)`', r'<code>\1</code>', value)
    value = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', value)
    value = re.sub(r'(https?://[^\s<]+)', r'<a href="\1">\1</a>', value)
    return value


def images(lines):
    result = []
    for line in lines:
        matched = re.fullmatch(r'!\[([^]]+)\]\(([^)]+)\)', line)
        caption, relative = matched.groups()
        path = (SOURCE.parent / relative).resolve()
        if not path.is_relative_to(SOURCE.parent) or path.suffix != '.png':
            raise ValueError('Handbook images must be local PNGs below docs/')
        encoded = base64.b64encode(path.read_bytes()).decode('ascii')
        uri = 'data:image/png;base64,' + encoded
        kind = 'phone' if path.name.startswith('mini-') else 'web'
        result.append(f'<figure class="{kind}"><a href="{uri}" target="_blank" title="查看原图"><img src="{uri}" alt="{html.escape(caption, quote=True)}"></a><figcaption>{inline(caption)}</figcaption></figure>')
    return '<div class="figures">' + ''.join(result) + '</div>'


def render(block):
    lines = block.strip().splitlines()
    output = []
    index = 0
    while index < len(lines):
        line = lines[index].strip()
        if not line:
            index += 1
            continue
        if line.startswith('#'):
            matched = re.fullmatch(r'(#{1,3})\s+(.+)', line)
            if not matched:
                raise ValueError('Unsupported heading: ' + line)
            level = len(matched[1])
            output.append(f'<h{level}>{inline(matched[2])}</h{level}>')
            index += 1
        elif line.startswith('!['):
            group = []
            while index < len(lines) and lines[index].strip().startswith('!['):
                group.append(lines[index].strip())
                index += 1
            output.append(images(group))
        elif line.startswith('|'):
            rows = []
            while index < len(lines) and lines[index].strip().startswith('|'):
                row = lines[index].strip()
                if not re.fullmatch(r'\|[\s|:\-]+\|', row):
                    rows.append([cell.strip() for cell in row.strip('|').split('|')])
                index += 1
            width = len(rows[0])
            if any(len(row) != width for row in rows):
                raise ValueError('Inconsistent table column count')
            table = '<div class="table-wrap"><table><thead><tr>' + ''.join('<th>' + inline(cell) + '</th>' for cell in rows[0]) + '</tr></thead><tbody>'
            for row in rows[1:]:
                table += '<tr>' + ''.join('<td>' + inline(cell) + '</td>' for cell in row) + '</tr>'
            output.append(table + '</tbody></table></div>')
        elif re.match(r'(\d+\. |\- )', line):
            numbered = bool(re.match(r'\d+\. ', line))
            tag = 'ol' if numbered else 'ul'
            items = []
            pattern = r'^\d+\. (.*)' if numbered else r'^- (.*)'
            while index < len(lines):
                matched = re.match(pattern, lines[index].strip())
                if not matched:
                    break
                items.append('<li>' + inline(matched[1]) + '</li>')
                index += 1
            output.append('<' + tag + '>' + ''.join(items) + '</' + tag + '>')
        else:
            paragraph = []
            while index < len(lines) and lines[index].strip():
                paragraph.append(lines[index].strip())
                index += 1
            output.append('<p>' + inline(' '.join(paragraph)) + '</p>')
    return '\n'.join(output)


source = SOURCE.read_text()
blocks = source.split('<!-- page -->')
sections = []
links = []
for number, block in enumerate(blocks, 1):
    title = re.search(r'^#{1,2} (.+)', block, re.M)[1]
    links.append(f'<a href="#sheet-{number}">{inline(title)}</a>')
    sections.append(f'<section class="sheet" id="sheet-{number}">{render(block)}<footer><span>棚户记账 · 使用手册1.2.1</span><span>{number} / {len(blocks)}</span></footer></section>')

css = '''
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:#edf3ef;color:#193d2e;font-family:"Noto Sans CJK SC","Microsoft YaHei",sans-serif;font-size:15.5px;line-height:1.65}
.toolbar{position:sticky;top:0;z-index:3;padding:12px 18px;background:#176747;color:white;display:flex;gap:16px;align-items:center;flex-wrap:wrap}.toolbar button{border:0;border-radius:8px;background:white;color:#176747;font-size:15px;padding:8px 14px;cursor:pointer}.toolbar details{flex:1}.toolbar details a{display:block;color:#fff;padding:3px}.toolbar summary{cursor:pointer}.toolbar details[open]{max-height:60vh;overflow:auto}
.sheet{position:relative;max-width:794px;min-height:250mm;background:white;padding:32px 36px 64px;margin:24px auto;box-shadow:0 4px 25px #123d2415;border-radius:12px}h1{font-size:36px;color:#176747;line-height:1.3;margin:12px 0 24px}h2{font-size:25px;border-left:5px solid #176747;padding-left:12px;line-height:1.35;margin:0 0 18px}p{margin:10px 0}ol,ul{padding-left:25px;margin:9px 0 14px}li{padding-left:3px;margin:6px 0}strong{color:#113e2b}a{color:#176747;overflow-wrap:anywhere}code{background:#eef5ef;border-radius:3px;padding:2px 4px;font-size:90%}.table-wrap{overflow:auto;margin:16px 0}table{border-collapse:collapse;width:100%;font-size:13px;line-height:1.6}th,td{padding:9px 8px;border:1px solid #d7e4da;vertical-align:top}th{background:#e7f2e9;color:#176747;text-align:left}tr:nth-child(even) td{background:#f6faf7}.figures{display:flex;justify-content:center;align-items:flex-start;gap:16px;margin:14px 0;break-inside:avoid}figure{flex:1;margin:0;text-align:center;min-width:0}figure img{display:block;max-width:100%;height:auto;margin:0 auto;border:1px solid #d9e7dd;border-radius:7px}figure.phone img{max-height:131mm}figure.web img{max-height:140mm}figcaption{font-size:12px;line-height:1.5;color:#56695b;margin-top:7px}footer{position:absolute;bottom:15px;left:36px;right:36px;border-top:1px solid #dfe9e1;padding-top:8px;display:flex;justify-content:space-between;color:#6a7e6c;font-size:11px}.compact{font-size:14px;line-height:1.5}.compact li{margin:4px 0}.compact p{margin:8px 0}.compact .phone img{max-height:117mm}.compact .web img{max-height:123mm}.compact table{font-size:12px}.compact h2{font-size:23px}
@media screen and (max-width:620px){.sheet{padding:24px 18px 60px;min-height:0;border-radius:0;margin:12px 0}.figures{display:block}figure{margin:14px auto}.phone img{max-height:none;width:min(100%,375px)}h1{font-size:29px}h2{font-size:22px}footer{left:18px;right:18px}.table-wrap{font-size:12px}}
@page{size:A4;margin:14mm 14mm 13mm}
@media print{html{scroll-behavior:auto}body{background:white;-webkit-print-color-adjust:exact;print-color-adjust:exact}.toolbar{display:none}.sheet{min-height:250mm;max-width:none;margin:0;padding:0 0 13mm;box-shadow:none;border:0;border-radius:0;break-after:page;break-inside:avoid}.sheet:last-child{break-after:auto}footer{bottom:0;left:0;right:0}.table-wrap{overflow:visible}.figures img{border-radius:5px}a{color:inherit;text-decoration:none}h1{margin-top:10mm}}
'''
OUTPUT.parent.mkdir(exist_ok=True)
OUTPUT.write_text('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>棚户记账图文使用手册1.2.1</title><style>' + css + '</style></head><body><div class="toolbar"><strong style="color:white">棚户记账使用手册</strong><button type="button" onclick="window.print()">打印 / 保存PDF</button><details><summary>查看目录</summary>' + ''.join(links) + '</details></div><main>' + ''.join(sections) + '</main></body></html>')
print(f'Generated self-contained HTML: {len(blocks)} sections, {source.count("![")} screenshots')
