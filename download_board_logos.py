from pathlib import Path
from urllib.request import Request, urlopen
import shutil
import time

LOGO_FOLDER = Path("assets/team-logos")
LOGO_FOLDER.mkdir(parents=True, exist_ok=True)

# Uses official cricket board / team website domains.
# File names match your tour.js TEAM_LOGOS paths.
BOARD_DOMAINS = {
    "afghanistan.png": "acb.af",
    "australia.png": "cricket.com.au",
    "bangladesh.png": "tigercricket.com.bd",
    "canada.png": "cricketcanada.org",
    "england.png": "ecb.co.uk",
    "india.png": "bcci.tv",
    "ireland.png": "cricketireland.ie",
    "namibia.png": "cricketnamibia.com",
    "nepal.png": "cricketnepal.org.np",
    "netherlands.png": "kncb.nl",
    "new-zealand.png": "nzc.nz",
    "oman.png": "omancricket.org",
    "pakistan.png": "pcb.com.pk",
    "scotland.png": "cricketscotland.com",
    "south-africa.png": "cricket.co.za",
    "sri-lanka.png": "srilankacricket.lk",
    "united-arab-emirates.png": "emiratescricket.com",
    "united-states-of-america.png": "usacricket.org",
    "west-indies.png": "windiescricket.com",
    "zimbabwe.png": "zimcricket.org"
}

HEADERS = {
    "User-Agent": "Mozilla/5.0 CricketDatabaseLocalProject"
}

def download_file(url, output_path):
    request = Request(url, headers=HEADERS)

    with urlopen(request, timeout=30) as response:
        with open(output_path, "wb") as file:
            shutil.copyfileobj(response, file)

def google_favicon_url(domain):
    return f"https://www.google.com/s2/favicons?domain={domain}&sz=256"

print("Downloading cricket board website logos/icons...")
print(f"Saving into: {LOGO_FOLDER.resolve()}")
print()

success = []
failed = []

for filename, domain in BOARD_DOMAINS.items():
    output_path = LOGO_FOLDER / filename
    url = google_favicon_url(domain)

    try:
        print(f"Downloading {filename} from {domain}...")
        download_file(url, output_path)
        success.append(filename)
        print(f"SAVED: {output_path}")

    except Exception as error:
        failed.append(filename)
        print(f"FAILED: {filename}")
        print(f"Reason: {error}")

    time.sleep(1)

print()
print("Done.")

print()
print("Downloaded:")
for item in success:
    print(f"  ✅ {item}")

print()
print("Failed:")
for item in failed:
    print(f"  ❌ {item}")

print()
print("Folder:")
print(LOGO_FOLDER.resolve())