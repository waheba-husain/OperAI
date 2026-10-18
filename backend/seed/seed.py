"""Reload simulated seed data. Safe to re-run.
Run from backend/:  python seed/seed.py
"""
import sys
from datetime import datetime, timedelta, timezone
from decimal import Decimal as D
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1]))

from sqlalchemy import create_engine, text  # noqa: E402

from app.config import settings  # noqa: E402

SRC = "simulated"
IST = timezone(timedelta(hours=5, minutes=30))
engine = create_engine(settings.database_url)

# key, name, unit, stock, cost_per_unit, allergens, diet
INGREDIENTS = [
    ("paneer", "Paneer", "kg", "1.000", "380.00", ["dairy"], ["veg"]),
    ("tofu", "Tofu", "kg", "3.000", "220.00", ["soy"], ["veg", "vegan"]),
    ("rice", "Basmati rice", "kg", "12.000", "110.00", [], ["veg", "vegan"]),
    ("veg", "Mixed vegetables", "kg", "6.000", "60.00", [], ["veg", "vegan"]),
    ("onion", "Onion", "kg", "8.000", "40.00", [], ["veg", "vegan"]),
]

# key, name, price, packaging, prep_min, cook_min, recipe
DISHES = [
    ("B", "Paneer Biryani", "180.00", "14.00", 15, 35, {"paneer": "0.150", "rice": "0.120", "onion": "0.050"}),
    ("P", "Paneer Butter Masala", "220.00", "16.00", 10, 25, {"paneer": "0.120", "onion": "0.080"}),
    ("V", "Veg Pulao", "150.00", "12.00", 10, 25, {"rice": "0.120", "veg": "0.100", "onion": "0.040"}),
    ("VB", "Veg Biryani", "160.00", "14.00", 15, 35, {"rice": "0.120", "veg": "0.120", "onion": "0.050"}),
    ("J", "Jeera Rice", "90.00", "8.00", 5, 20, {"rice": "0.150"}),
]

# time (IST, 2026-10-17), customer, channel, [(dish, qty)]
ORDERS = [
    ("11:00", "Customer A", "whatsapp", [("B", 2)]),
    ("11:10", "Customer B", "swiggy", [("V", 1)]),
    ("11:20", "Customer C", "whatsapp", [("P", 1)]),
    ("11:30", "Customer D", "instagram", [("J", 2)]),
    ("11:40", "Customer E", "zomato", [("B", 1)]),
    ("11:50", "Customer F", "whatsapp", [("VB", 1)]),
    ("12:00", "Customer G", "direct", [("P", 2)]),
    ("12:10", "Customer H", "swiggy", [("V", 2)]),
    ("12:20", "Customer I", "whatsapp", [("B", 1)]),
    ("12:30", "Customer J", "zomato", [("J", 1)]),
    ("12:40", "Customer K", "whatsapp", [("B", 1), ("P", 1)]),
    ("12:50", "Customer L", "swiggy", [("VB", 2)]),
    ("13:00", "Customer M", "direct", [("B", 2)]),
    ("13:10", "Customer N", "whatsapp", [("V", 2)]),
    ("13:20", "Customer O", "instagram", [("J", 3)]),
    ("13:30", "Customer P", "zomato", [("P", 1), ("B", 1)]),
    ("13:40", "Customer Q", "whatsapp", [("VB", 1)]),
    ("13:50", "Customer R", "swiggy", [("V", 1)]),
    ("14:00", "Customer S", "direct", [("P", 1)]),
    ("14:10", "Customer T", "whatsapp", [("J", 2)]),
    ("14:20", "Customer U", "zomato", [("VB", 2)]),
    ("14:30", "Customer V", "swiggy", [("V", 2)]),
    ("14:40", "Customer W", "whatsapp", [("J", 1)]),
    ("14:50", "Customer X", "direct", [("VB", 1)]),
    ("15:00", "Customer Y", "instagram", [("V", 1)]),
]

RISK_SQL = """
SELECT i.name, i.stock_qty, SUM(oi.quantity * r.qty_per_portion) AS needed
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
JOIN recipe_items r ON r.menu_item_id = oi.menu_item_id
JOIN ingredients i ON i.id = r.ingredient_id
WHERE o.status NOT IN ('cancelled', 'completed')
GROUP BY i.id, i.name, i.stock_qty
HAVING SUM(oi.quantity * r.qty_per_portion) > i.stock_qty
"""


def main():
    with engine.begin() as c:
        c.execute(text("TRUNCATE kitchens CASCADE"))

        kid = c.execute(text(
            "INSERT INTO kitchens (name, burner_count, cook_count, overhead_pct, commission_pct,"
            " target_margin_pct, plan_version, data_source)"
            " VALUES ('Demo Kitchen', 3, 2, 12.00, 20.00, 25.00, 1, :s) RETURNING id"
        ), {"s": SRC}).scalar()

        ing = {}
        for key, name, unit, stock, cost, allergens, diet in INGREDIENTS:
            ing[key] = c.execute(text(
                "INSERT INTO ingredients (kitchen_id, name, unit, stock_qty, cost_per_unit,"
                " allergen_tags, diet_tags, data_source)"
                " VALUES (:k, :n, :u, :st, :co, CAST(:al AS text[]), CAST(:di AS text[]), :s) RETURNING id"
            ), {"k": kid, "n": name, "u": unit, "st": D(stock), "co": D(cost),
                "al": allergens, "di": diet, "s": SRC}).scalar()

        dish = {}
        for key, name, price, pack, prep, cook, recipe in DISHES:
            mid = c.execute(text(
                "INSERT INTO menu_items (kitchen_id, name, price, packaging_cost, prep_minutes,"
                " cook_minutes, data_source)"
                " VALUES (:k, :n, :p, :pk, :pr, :ck, :s) RETURNING id"
            ), {"k": kid, "n": name, "p": D(price), "pk": D(pack), "pr": prep, "ck": cook, "s": SRC}).scalar()
            dish[key] = (mid, D(price))
            for ikey, qty in recipe.items():
                c.execute(text(
                    "INSERT INTO recipe_items (menu_item_id, ingredient_id, qty_per_portion)"
                    " VALUES (:m, :i, :q)"
                ), {"m": mid, "i": ing[ikey], "q": D(qty)})

        c.execute(text(
            "INSERT INTO substitutions (kitchen_id, ingredient_id, substitute_ingredient_id,"
            " ratio, needs_consent, notes)"
            " VALUES (:k, :a, :b, 1.000, true, 'Texture differs; soy allergen added')"
        ), {"k": kid, "a": ing["paneer"], "b": ing["tofu"]})

        for n, (hhmm, customer, channel, items) in enumerate(ORDERS, start=1):
            h, m = map(int, hhmm.split(":"))
            deadline = datetime(2026, 10, 17, h, m, tzinfo=IST)
            total = sum(dish[d][1] * q for d, q in items)
            oid = c.execute(text(
                "INSERT INTO orders (kitchen_id, customer_name, customer_phone, channel, deadline,"
                " status, total_amount, data_source)"
                " VALUES (:k, :cn, :ph, :ch, :dl, 'new', :t, :s) RETURNING id"
            ), {"k": kid, "cn": customer, "ph": f"9198000{n:05d}", "ch": channel,
                "dl": deadline, "t": total, "s": SRC}).scalar()
            for d, q in items:
                c.execute(text(
                    "INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price)"
                    " VALUES (:o, :m, :q, :p)"
                ), {"o": oid, "m": dish[d][0], "q": q, "p": dish[d][1]})

        print(f"Seeded kitchen, {len(INGREDIENTS)} ingredients, {len(DISHES)} dishes, {len(ORDERS)} orders.")
        print("Shortages (stock vs needed):")
        for name, stock, needed in c.execute(text(RISK_SQL)):
            print(f"  {name}: stock {stock}, needed {needed}")


if __name__ == "__main__":
    main()