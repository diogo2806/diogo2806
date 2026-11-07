#!/usr/bin/env python3
"""Gera os SVGs do perfil a partir da curadoria em portfolio.json."""
import json
from pathlib import Path
from xml.sax.saxutils import escape
from PIL import ImageFont

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'assets'
ASSETS.mkdir(exist_ok=True)
PROJECTS = json.loads((ROOT / 'portfolio.json').read_text())['projects']
BG, CARD, LINE, WHITE, MUTED, ACCENT = '#101B27', '#172637', '#30465C', '#F4F8FC', '#C0CFDE', '#72E0CB'
FONT = 'DejaVu Sans, Segoe UI, sans-serif'

def text(x, y, value, size=24, color=WHITE, weight=400, extra=''):
    return f'<text x="{x}" y="{y}" font-family="{FONT}" font-size="{size}" font-weight="{weight}" fill="{color}" {extra}>{escape(str(value))}</text>'

def rect(x, y, w, h, fill, rx=0, extra=''):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" {extra}/>'

def font(size, bold=False):
    return ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans' + ('-Bold' if bold else '') + '.ttf', size)

def wrap(value, size, width):
    lines, current = [], ''
    f = font(size)
    for word in value.split():
        candidate = (current + ' ' + word).strip()
        if f.getlength(candidate) > width and current:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines

def save(name, w, h, body, title, desc=''):
    value = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" role="img" aria-labelledby="title desc"><title id="title">{escape(title)}</title><desc id="desc">{escape(desc or title)}</desc>{body}</svg>\n'
    (ASSETS / name).write_text(value)

def hero(mobile=False):
    w, h = (720, 650) if mobile else (1280, 450)
    body = rect(0, 0, w, h, BG, 24)
    # A trama geométrica é decorativa; conteúdo profissional permanece em texto.
    body += f'<g fill="none" stroke="{LINE}" stroke-width="1.5" opacity=".65">'
    if not mobile:
        for i in range(5):
            body += f'<path d="M {1050+i*46} -80 L {800+i*46} 450"/>'
        body += '<circle cx="1110" cy="178" r="90"/><circle cx="1110" cy="178" r="126"/>'
    else:
        for i in range(4):
            body += f'<path d="M {530+i*46} -70 L {660+i*46} 190"/>'
    body += '</g>'
    body += rect(48, 42, 36, 5, ACCENT, 2)
    body += text(98, 52, 'ENGENHARIA DE SOFTWARE', 19, ACCENT, 700, 'letter-spacing="2"')
    if mobile:
        body += text(45, 158, 'Diogo', 86, WHITE, 700)
        body += text(45, 251, 'Santos', 86, WHITE, 700)
        body += text(48, 309, 'Java Sênior · Arquitetura', 29, MUTED)
        body += text(48, 352, 'Liderança técnica', 29, MUTED)
        body += text(48, 420, 'Software que entende', 31, WHITE, 600)
        body += text(48, 460, 'o negócio.', 31, WHITE, 600)
        body += rect(48, 502, 624, 1, LINE)
        body += text(48, 552, '30+ PROJETOS', 22, ACCENT, 700)
        body += text(365, 552, '15 EM DESTAQUE', 22, WHITE, 700)
        body += text(48, 600, 'BACKEND & FULL STACK  /  100% REMOTO', 20, MUTED)
    else:
        body += text(48, 164, 'Diogo Santos', 80, WHITE, 700)
        body += text(51, 218, 'Java Sênior · Arquitetura · Liderança técnica', 28, MUTED)
        body += text(51, 284, 'Software que entende o negócio.', 32, WHITE, 600)
        body += rect(50, 326, 1180, 1, LINE)
        for x, top, bottom in [(51, '30+', 'PROJETOS'), (282, '15', 'EM DESTAQUE'), (514, 'JAVA + SPRING', 'BACKEND & FULL STACK'), (972, 'REMOTO', 'ITAGUAÍ / RJ')]:
            body += text(x, 378, top, 31, ACCENT if x < 514 else WHITE, 700)
            body += text(x, 410, bottom, 16, MUTED, 500, 'letter-spacing="1.4"')
        body += text(1073, 195, 'DS', 53, ACCENT, 700)
    save('hero-mobile.svg' if mobile else 'hero.svg', w, h, body, 'Diogo Santos — Java Sênior, arquitetura e liderança técnica', 'Software que entende o negócio. Mais de 30 projetos; 15 em destaque. Backend e full stack. Trabalho remoto, Itaguaí/RJ.')

def card(project, x=0, y=0):
    rank = str(project['rank']).zfill(2)
    accent = ACCENT if project['rank'] <= 5 else '#A4C8EC'
    out = f'<g transform="translate({x} {y})">'
    out += rect(0, 0, 624, 332, CARD, 18, f'stroke="{LINE}"')
    out += rect(0, 25, 4, 54, accent, 2)
    out += text(28, 40, rank + ' / ' + project['sector'], 17, accent, 700, 'letter-spacing=".8"')
    out += text(28, 92, project['name'], 39, WHITE, 700)
    lines = wrap(project['desc'], 25, 566)
    for i, line in enumerate(lines):
        out += text(28, 139 + i*33, line, 25, MUTED)
    assert len(lines) <= 3, project['name']
    px = 28
    for tech in project['tech']:
        width = round(font(18, True).getlength(tech)) + 26
        out += rect(px, 251, width, 30, '#203A4C', 7)
        out += text(px+13, 272, tech, 18, '#BBE4F1', 700)
        px += width+10
    assert px < 620, (project['name'], px)
    out += text(28, 311, project['focus'], 18, '#B3C3D4')
    return out + '</g>'

hero()
hero(True)
for i in range(0, 15, 2):
    pair = PROJECTS[i:i+2]
    desktop = ''.join(card(p, (j*656), 0) for j, p in enumerate(pair))
    # Uma última linha com um único cartão preserva a mesma escala tipográfica.
    save(f'projects-{i//2+1:02}.svg', 1280, 340, desktop, ' | '.join(f"{p['rank']:02}. {p['name']}" for p in pair), ' '.join(p['desc'] for p in pair))
    mobile = ''.join(card(p, 0, j*352) for j, p in enumerate(pair))
    save(f'projects-{i//2+1:02}-mobile.svg', 624, len(pair)*352-12, mobile, ' | '.join(f"{p['rank']:02}. {p['name']}" for p in pair), ' '.join(p['desc'] for p in pair))

for name, label, color in [('linkedin', 'LinkedIn', '#184966'), ('email', 'E-mail', '#23364A'), ('whatsapp', 'WhatsApp', '#245348')]:
    save(f'{name}.svg', 184, 48, rect(0,0,184,48,color,10)+text(92,31,label,21,WHITE,700,'text-anchor="middle"'), label)

techs = [('Java','BACKEND'),('Spring','APIs'),('PostgreSQL','DADOS'),('Oracle','DADOS'),('React','FRONTEND'),('TypeScript','FRONTEND'),('Docker','ENTREGA'),('Testes','QUALIDADE')]
for mobile in [False, True]:
    cols = 2 if mobile else 4
    w = 624 if mobile else 1280
    tw = 304
    gap = 16 if mobile else 21
    body = ''
    for i,(label,sub) in enumerate(techs):
        x,y=(i%cols)*(tw+gap),(i//cols)*106
        body += rect(x,y,tw,90,BG,12)
        body += text(x+22,y+38,label,28,WHITE,700)
        body += text(x+22,y+68,sub,16,ACCENT,600,'letter-spacing="1.3"')
    save('stack-mobile.svg' if mobile else 'stack.svg',w,(len(techs)//cols)*106-16,body,'Java, Spring, PostgreSQL, Oracle, React, TypeScript, Docker e testes')

for mobile in [False, True]:
    w,h=(720,238) if mobile else (1280,210)
    body=rect(0,0,w,h,BG,20)+rect(38,42,5,h-84,ACCENT,2)
    body+=text(68,85,'Vamos construir o próximo projeto?',31 if mobile else 42,WHITE,700)
    if mobile:
        body+=text(68,135,'Java Sênior e Tech Lead',26,MUTED)
        body+=text(68,180,'100% remoto · Converse no LinkedIn',23,ACCENT,600)
    else:
        body+=text(68,135,'Java Sênior e Tech Lead · 100% remoto',27,MUTED)
        body+=text(68,177,'CONVERSE COMIGO NO LINKEDIN',18,ACCENT,700,'letter-spacing="1.5"')
    save('contact-mobile.svg' if mobile else 'contact.svg',w,h,body,'Vamos construir o próximo projeto? Java Sênior e Tech Lead, 100% remoto. Converse no LinkedIn.')

print(f'{len(list(ASSETS.glob("*.svg")))} SVGs gerados; {len(PROJECTS)} projetos.')
