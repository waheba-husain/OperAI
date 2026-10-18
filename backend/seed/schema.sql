-- OperAI schema (Postgres / Supabase). Safe to re-run.
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS proposed_actions CASCADE;
DROP TABLE IF EXISTS plan_tasks CASCADE;
DROP TABLE IF EXISTS order_items CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS substitutions CASCADE;
DROP TABLE IF EXISTS recipe_items CASCADE;
DROP TABLE IF EXISTS menu_items CASCADE;
DROP TABLE IF EXISTS ingredients CASCADE;
DROP TABLE IF EXISTS kitchens CASCADE;
DROP FUNCTION IF EXISTS audit_block_changes() CASCADE;

CREATE TABLE kitchens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  burner_count int NOT NULL CHECK (burner_count > 0),
  cook_count int NOT NULL CHECK (cook_count > 0),
  overhead_pct numeric(5,2) NOT NULL DEFAULT 0,
  commission_pct numeric(5,2) NOT NULL DEFAULT 0,
  target_margin_pct numeric(5,2) NOT NULL DEFAULT 25,
  plan_version int NOT NULL DEFAULT 1,
  data_source text NOT NULL CHECK (data_source IN ('simulated','verified')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ingredients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kitchen_id uuid NOT NULL REFERENCES kitchens(id),
  name text NOT NULL,
  unit text NOT NULL,
  stock_qty numeric(10,3) NOT NULL CHECK (stock_qty >= 0),
  cost_per_unit numeric(10,2) NOT NULL CHECK (cost_per_unit >= 0),
  allergen_tags text[] NOT NULL DEFAULT '{}',
  diet_tags text[] NOT NULL DEFAULT '{}',
  data_source text NOT NULL CHECK (data_source IN ('simulated','verified')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kitchen_id, name)
);

CREATE TABLE menu_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kitchen_id uuid NOT NULL REFERENCES kitchens(id),
  name text NOT NULL,
  price numeric(10,2) NOT NULL CHECK (price >= 0),
  packaging_cost numeric(10,2) NOT NULL DEFAULT 0,
  prep_minutes int NOT NULL,
  cook_minutes int NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  data_source text NOT NULL CHECK (data_source IN ('simulated','verified')),
  UNIQUE (kitchen_id, name)
);
CREATE INDEX idx_menu_active ON menu_items (kitchen_id) WHERE is_active;

CREATE TABLE recipe_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id uuid NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  ingredient_id uuid NOT NULL REFERENCES ingredients(id),
  qty_per_portion numeric(10,3) NOT NULL CHECK (qty_per_portion > 0),
  UNIQUE (menu_item_id, ingredient_id)
);
CREATE INDEX idx_recipe_ingredient ON recipe_items (ingredient_id);

CREATE TABLE substitutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kitchen_id uuid NOT NULL REFERENCES kitchens(id),
  ingredient_id uuid NOT NULL REFERENCES ingredients(id),
  substitute_ingredient_id uuid NOT NULL REFERENCES ingredients(id),
  ratio numeric(6,3) NOT NULL DEFAULT 1,
  needs_consent boolean NOT NULL DEFAULT true,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  CHECK (ingredient_id <> substitute_ingredient_id),
  UNIQUE (ingredient_id, substitute_ingredient_id)
);

CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kitchen_id uuid NOT NULL REFERENCES kitchens(id),
  customer_name text NOT NULL,
  customer_phone text,
  channel text NOT NULL CHECK (channel IN ('whatsapp','instagram','swiggy','zomato','direct')),
  deadline timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','planned','in_progress','delayed','partial','completed','cancelled')),
  total_amount numeric(10,2) NOT NULL,
  source_text text,
  extraction_confidence numeric(3,2) CHECK (extraction_confidence BETWEEN 0 AND 1),
  data_source text NOT NULL CHECK (data_source IN ('simulated','verified')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_orders_deadline ON orders (kitchen_id, deadline);
CREATE INDEX idx_orders_status ON orders (kitchen_id, status);

CREATE TABLE order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id uuid NOT NULL REFERENCES menu_items(id),
  quantity int NOT NULL CHECK (quantity > 0),
  unit_price numeric(10,2) NOT NULL,
  swapped_from_item_id uuid REFERENCES menu_items(id)
);
CREATE INDEX idx_order_items_order ON order_items (order_id);
CREATE INDEX idx_order_items_menu ON order_items (menu_item_id);

CREATE TABLE plan_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kitchen_id uuid NOT NULL REFERENCES kitchens(id),
  order_item_id uuid NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  task_type text NOT NULL CHECK (task_type IN ('prep','cook','pack')),
  burner_no int,
  cook_no int NOT NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled','in_progress','done','cancelled')),
  locked boolean NOT NULL DEFAULT false,
  plan_version int NOT NULL,
  CHECK (end_at > start_at)
);
CREATE INDEX idx_tasks_start ON plan_tasks (kitchen_id, start_at);
CREATE INDEX idx_tasks_item ON plan_tasks (order_item_id);

CREATE TABLE proposed_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kitchen_id uuid NOT NULL REFERENCES kitchens(id),
  group_id uuid NOT NULL,
  option_number int NOT NULL,
  action_type text NOT NULL CHECK (action_type IN ('recovery','price_change','order_intake','undo')),
  title text NOT NULL,
  payload jsonb NOT NULL,
  impact jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','executed','rejected','expired','failed')),
  base_plan_version int NOT NULL,
  stock_fingerprint text NOT NULL,
  undo_of_audit_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  decided_at timestamptz,
  executed_at timestamptz,
  UNIQUE (group_id, option_number)
);
CREATE INDEX idx_actions_status ON proposed_actions (kitchen_id, status, created_at DESC);

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kitchen_id uuid NOT NULL REFERENCES kitchens(id),
  action_id uuid REFERENCES proposed_actions(id),
  event_type text NOT NULL,
  actor text NOT NULL CHECK (actor IN ('owner','system','agent')),
  summary text NOT NULL,
  before_snapshot jsonb,
  after_snapshot jsonb,
  plan_version_before int,
  plan_version_after int,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_created ON audit_logs (kitchen_id, created_at DESC);
CREATE INDEX idx_audit_action ON audit_logs (action_id);

-- Circular reference: added after both tables exist
ALTER TABLE proposed_actions
  ADD CONSTRAINT fk_undo_audit FOREIGN KEY (undo_of_audit_id) REFERENCES audit_logs(id);

-- Audit log is append-only
CREATE FUNCTION audit_block_changes() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_no_update_delete
BEFORE UPDATE OR DELETE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION audit_block_changes();

-- RLS on, no public policies (backend connects with its own credentials)
ALTER TABLE kitchens ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE substitutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposed_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;