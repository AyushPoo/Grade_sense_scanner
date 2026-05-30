with open('f:/GradeSense/Scan/GradeSense-Scanner/frontend/src/store/scanStore.ts', 'r', encoding='utf-8') as f:
    content = f.read()

import re
matches = re.findall(r'(?:clear|reset|wipe)\w*\s*:\s*\([^)]*\)\s*=>[\s\S]*?\}', content, re.IGNORECASE)
for m in matches[:10]:
    print(m)
    print("-" * 50)
if not matches:
    # search for key names
    print("Methods containing reset or clear:")
    for line in content.splitlines():
        if 'clear' in line.lower() or 'reset' in line.lower() or 'wipe' in line.lower():
            print(line.strip())
