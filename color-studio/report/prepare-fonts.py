"""Optional development tool: fontTools + Brotli required. Never run at app startup."""
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
fonts = Path(__file__).resolve().parent.parent / 'fonts'
for weight, style in [(400, 'Regular'), (600, 'Semibold')]:
    font = instantiateVariableFont(TTFont(fonts / 'PretendardVariable.woff2'), {'wght': weight}, inplace=True)
    names = {1: 'Color Studio Report', 2: style, 3: 'ColorStudioReport-' + style,
             4: 'Color Studio Report ' + style, 6: 'ColorStudioReport-' + style,
             16: 'Color Studio Report', 17: style}
    for record in font['name'].names:
        if record.nameID in names:
            record.string = names[record.nameID].encode(record.getEncoding())
    font.flavor = None
    font.save(fonts / ('Report' + style + '.ttf'))
