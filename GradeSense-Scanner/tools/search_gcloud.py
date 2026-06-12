import os

paths_to_check = [
    os.environ.get("APPDATA", ""),
    os.environ.get("LOCALAPPDATA", ""),
    "C:\\Program Files",
    "C:\\Program Files (x86)",
    "F:\\"
]

found = []
for p in paths_to_check:
    if not p or not os.path.exists(p):
        continue
    print(f"Searching in {p}...")
    try:
        for root, dirs, files in os.walk(p):
            # limit depth to 4 levels
            depth = root[len(p):].count(os.sep)
            if depth > 3:
                # prevent walking deep
                dirs.clear()
                continue
            for d in dirs:
                if "google-cloud-sdk" in d.lower() or "google-cloud" in d.lower():
                    full_path = os.path.join(root, d)
                    print(f"-> Found possible Cloud SDK: {full_path}")
                    found.append(full_path)
    except Exception as e:
        pass

print("\nScan completed. Found SDK paths:")
for f in found:
    print(f)
