"""Deterministic local typography card. No external image service or platform calls."""
import io
from pathlib import Path
import re
from PIL import Image, ImageDraw, ImageFont


def font(size):
    paths = ('C:/Windows/Fonts/msyh.ttc', 'C:/Windows/Fonts/simhei.ttf',
             '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
             '/System/Library/Fonts/PingFang.ttc')
    for path in paths:
        if Path(path).is_file():
            return ImageFont.truetype(path, size)
    raise ValueError('本地中文字体不可用，请手动选择配图。')


def draw_card(params):
    body, week = params.get('body'), params.get('week')
    count, sources = params.get('count'), params.get('sources')
    if not isinstance(body, str) or not body.strip() or len(body) > 1800 or '\0' in body:
        raise ValueError('卡片正文无效。')
    if not isinstance(week, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', week):
        raise ValueError('卡片周标识无效。')
    if type(count) is not int or not 1 <= count <= 30 or not isinstance(sources, list) or not sources or any(s not in ('subtitle', 'asr', 'comments') for s in sources):
        raise ValueError('卡片公开来源无效。')
    canvas = Image.new('RGB', (1200, 1500), '#eff4f7')
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle((60, 60, 1140, 1440), radius=42, fill='#ffffff')
    draw.rounded_rectangle((110, 112, 265, 152), radius=20, fill='#e4f6fc')
    draw.text((134, 114), '一周见闻', font=font(25), fill='#087b9b')
    draw.text((110, 185), '慢慢看，也慢慢想。', font=font(61), fill='#173747')
    draw.text((110, 280), '周记录  /  ' + week, font=font(29), fill='#617a87')
    draw.line((110, 357, 1090, 357), fill='#dce9ee', width=3)
    text = body.strip().replace('\r', '')
    content_font = font(43)
    lines, current = [], ''
    # The whole body remains in the reviewed editor; the card is explicitly an excerpt.
    for char in text[:500]:
        if char == '\n':
            lines.append(current); current = ''; continue
        if draw.textlength(current + char, font=content_font) > 970:
            if current and (char in '，。！？；：、）》】」』…' or current[-1] in '（《【「『'):
                lines.append(current[:-1]); current = current[-1] + char
            else:
                lines.append(current); current = char
        else:
            current += char
    if current:
        lines.append(current)
    clipped = len(lines) > 12 or len(text) > 500
    lines = lines[:12]
    if clipped:
        lines[-1] = lines[-1][:max(0, len(lines[-1]) - 1)] + '…'
    for index, line in enumerate(lines):
        draw.text((110, 414 + index * 60), line, font=content_font, fill='#294754')
    draw.rounded_rectangle((110, 1210, 1090, 1350), radius=24, fill='#f0f7fa')
    labels = {'subtitle': '字幕', 'asr': '讲话转写', 'comments': '评论区样本'}
    basis = ' / '.join(labels[s] for s in dict.fromkeys(sources))
    draw.text((140, 1229), str(count) + ' 个已读视频  ·  正文节选' if clipped else str(count) + ' 个已读视频  ·  文字整理', font=font(29), fill='#16677e')
    draw.text((140, 1286), '依据：' + basis, font=font(26), fill='#617a87')
    draw.text((110, 1380), '基于已读公开材料整理，未展示视频画面。', font=font(23), fill='#7a929c')
    output = io.BytesIO(); canvas.save(output, format='JPEG', quality=91)
    return output.getvalue()
