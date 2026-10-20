"""Parse a saved https://www.tornstats.com/items HTML snapshot (stdlib only).
Usage: python scripts/import-tornstats.py snapshot.html [output.json]
"""
from html.parser import HTMLParser
from pathlib import Path
import hashlib
import json
import re
import sys

class ItemsParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.active = False
        self.cells = None
        self.cell = None
        self.rows = []
        self.image = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'table' and attrs.get('id') == 'items-table':
            self.active = True
        if not self.active:
            return
        if tag == 'tr':
            self.cells, self.image = [], None
        if tag == 'td':
            self.cell = []
        if tag == 'img':
            self.image = attrs.get('src')
        if tag == 'br' and self.cell is not None:
            self.cell.append(' ')

    def handle_data(self, data):
        if self.active and self.cell is not None:
            self.cell.append(data)

    def handle_endtag(self, tag):
        if not self.active:
            return
        if tag == 'td' and self.cell is not None:
            self.cells.append(' '.join(''.join(self.cell).split()))
            self.cell = None
        if tag == 'tr' and self.cells:
            if len(self.cells) != 8:
                raise ValueError('Unexpected item table columns')
            match = re.fullmatch(r'(.+) \[(\d+)\]', self.cells[1])
            if not match:
                raise ValueError('Missing name or ID')
            def number(value):
                return int(value.replace('$', '').replace(',', ''))
            self.rows.append(dict(id=int(match[2]), name=match[1],
                description=self.cells[2], type=self.cells[3],
                buy=number(self.cells[4]), sell=number(self.cells[5]),
                market_value=number(self.cells[6]), circulation=number(self.cells[7]),
                image=self.image))
        if tag == 'table':
            self.active = False

if __name__ == '__main__':
    snapshot = Path(sys.argv[1]).read_bytes()
    parser = ItemsParser()
    parser.feed(snapshot.decode('utf-8'))
    ids = [item['id'] for item in parser.rows]
    if not ids or len(ids) != len(set(ids)):
        raise ValueError('Empty catalog or duplicate IDs')
    data = dict(source='https://www.tornstats.com/items', fetched='2026-10-19',
        snapshotSha256=hashlib.sha256(snapshot).hexdigest(),
        items=sorted(parser.rows, key=lambda item: item['id']))
    Path(sys.argv[2] if len(sys.argv)>2 else 'data/tornstats-items.json').write_text(
        json.dumps(data, indent=2, ensure_ascii=False)+'\n')
    print(f'Imported {len(ids)} unique items; highest ID {max(ids)}')
