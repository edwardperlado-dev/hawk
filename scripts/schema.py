"""Export or verify the API contract used by the TypeScript client."""

import json
import sys
from pathlib import Path

from backend.api import app

target = Path("backend/openapi.json")
output = json.dumps(app.openapi(), indent=2) + "\n"
if "--check" in sys.argv:
    if not target.exists() or target.read_text() != output:
        sys.exit("OpenAPI drift. Regenerate the schema and frontend types.")
else:
    target.write_text(output)
