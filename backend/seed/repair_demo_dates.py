"""One-time safe data-repair utility for simulated demo orders.

Safe to review and dry-run:
  python seed/repair_demo_dates.py               # dry run (no changes)
  python seed/repair_demo_dates.py --apply       # applies update in single atomic transaction
  python seed/repair_demo_dates.py --target-date 2026-10-23 --apply
"""
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1]))

from sqlalchemy import create_engine, text  # noqa: E402

from app.config import settings  # noqa: E402

IST = timezone(timedelta(hours=5, minutes=30))
engine = create_engine(settings.database_url)


def parse_args() -> tuple[date, bool]:
    apply_changes = "--apply" in sys.argv
    target_date = datetime.now(IST).date()
    for i, arg in enumerate(sys.argv):
        if arg.startswith("--target-date="):
            target_date = date.fromisoformat(arg.split("=", 1)[1])
        elif arg == "--target-date" and i + 1 < len(sys.argv):
            target_date = date.fromisoformat(sys.argv[i + 1])
    return target_date, apply_changes


def main():
    target_date, apply_changes = parse_args()
    source_date = date(2026, 10, 17)

    src_start = datetime(source_date.year, source_date.month, source_date.day, 0, 0, 0, tzinfo=IST)
    src_end = src_start + timedelta(days=1)

    print("=== OperAI Demonstration Data Repair Utility ===")
    print(f"Source date: {source_date.isoformat()} (IST)")
    print(f"Target date: {target_date.isoformat()} (IST)")
    print(f"Mode: {'APPLY MUTATIONS' if apply_changes else 'DRY RUN (no database changes)'}")

    with engine.begin() as conn:
        rows = conn.execute(text(
    "SELECT id, customer_name, deadline, status, total_amount "
    "FROM orders "
    "WHERE kitchen_id = :kitchen_id "
    "  AND data_source = 'simulated' "
    "  AND deadline >= :start "
    "  AND deadline < :end "
    "ORDER BY deadline ASC"
), {
    "kitchen_id": "d93a9147-227a-44f6-b30b-c10de7ba0c87",
    "start": src_start,
    "end": src_end,
}).mappings().all()

        print(f"\nFound {len(rows)} simulated orders eligible for date alignment.")

        if not rows:
            print("No matching simulated orders found for 2026-10-17. Database is already aligned or empty.")
            return

        print("\nSample preview (first 3 orders):")
        for r in rows[:3]:
            curr_dl = r["deadline"]
            # Compute new deadline with target_date but identical time of day and IST offset
            new_dl = datetime(
                target_date.year,
                target_date.month,
                target_date.day,
                curr_dl.hour,
                curr_dl.minute,
                curr_dl.second,
                curr_dl.microsecond,
                tzinfo=curr_dl.tzinfo or IST,
            )
            print(f"  Order ID {r['id']} ({r['customer_name']}):")
            print(f"    Current:  {curr_dl.isoformat()}")
            print(f"    Proposed: {new_dl.isoformat()}")

        if not apply_changes:
            print("\n[DRY RUN COMPLETE] To execute this repair transaction, re-run with --apply.")
            return

        # Perform atomic batch update
        updated_count = 0
        for r in rows:
            curr_dl = r["deadline"]
            new_dl = datetime(
                target_date.year,
                target_date.month,
                target_date.day,
                curr_dl.hour,
                curr_dl.minute,
                curr_dl.second,
                curr_dl.microsecond,
                tzinfo=curr_dl.tzinfo or IST,
            )
            res = conn.execute(text(
                "UPDATE orders SET deadline = :new_dl WHERE id = :id"
            ), {"new_dl": new_dl, "id": r["id"]})
            updated_count += res.rowcount

        print(f"\n[SUCCESS] Safely updated {updated_count} order deadline timestamps to {target_date.isoformat()}.")


if __name__ == "__main__":
    main()
