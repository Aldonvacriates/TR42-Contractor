import os
from dotenv import load_dotenv
from pathlib import Path
load_dotenv(Path(__file__).parent / '.env')  # always finds backend/.env regardless of cwd

from app import create_app
from app.models import db

# Render sets the RENDER env var automatically — use ProductionConfig there.
# Everything else (local dev) stays on DevelopmentConfig.
config = 'ProductionConfig' if os.environ.get('RENDER') else 'DevelopmentConfig'
app = create_app(config)

with app.app_context():
    # ONE-TIME schema reset: drop inspections + results tables so create_all()
    # rebuilds them with the current model (notes, skipped, no_issues_found cols).
    # Safe to run repeatedly — CASCADE handles the FK constraint ordering.
    # Revert this block to just db.create_all() after the next deploy lands.
    from sqlalchemy import text, inspect as sa_inspect
    inspector = sa_inspect(db.engine)
    existing = inspector.get_table_names()
    if 'inspection_results' in existing or 'inspections' in existing:
        with db.engine.connect() as conn:
            conn.execute(text('DROP TABLE IF EXISTS inspection_results CASCADE'))
            conn.execute(text('DROP TABLE IF EXISTS inspections CASCADE'))
            conn.commit()
    db.create_all()

if __name__ == '__main__':
    app.run(host='0.0.0.0')