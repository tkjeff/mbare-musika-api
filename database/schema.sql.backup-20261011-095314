CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name VARCHAR(150) NOT NULL,
    email VARCHAR(254) NOT NULL UNIQUE,
    phone VARCHAR(30),
    password_hash TEXT NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'CUSTOMER'
        CHECK (role IN ('CUSTOMER', 'SELLER', 'RIDER', 'ADMIN', 'OWNER')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DO $$
DECLARE
    role_constraint_definition TEXT;
BEGIN
    SELECT pg_get_constraintdef(oid)
    INTO role_constraint_definition
    FROM pg_constraint
    WHERE conrelid = 'users'::regclass
      AND conname = 'users_role_check';

    IF role_constraint_definition IS NOT NULL
       AND POSITION('OWNER' IN role_constraint_definition) = 0 THEN
        ALTER TABLE users DROP CONSTRAINT users_role_check;
        role_constraint_definition := NULL;
    END IF;

    IF role_constraint_definition IS NULL THEN
        ALTER TABLE users
            ADD CONSTRAINT users_role_check
            CHECK (role IN ('CUSTOMER', 'SELLER', 'RIDER', 'ADMIN', 'OWNER'));
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS seller_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    business_name VARCHAR(180) NOT NULL,
    business_description TEXT,
    approval_status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (approval_status IN ('PENDING', 'APPROVED', 'REJECTED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rider_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    vehicle_type VARCHAR(50),
    license_number VARCHAR(100),
    approval_status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (approval_status IN ('PENDING', 'APPROVED', 'REJECTED')),
    availability_status VARCHAR(20) NOT NULL DEFAULT 'OFFLINE'
        CHECK (availability_status IN ('OFFLINE', 'AVAILABLE', 'BUSY')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id UUID NOT NULL REFERENCES users(id),
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    name VARCHAR(180) NOT NULL,
    description TEXT,
    price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
    currency CHAR(3) NOT NULL DEFAULT 'USD',
    stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
    image_url TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DO $$
DECLARE
    role_constraint_definition TEXT;
BEGIN
    SELECT pg_get_constraintdef(oid)
    INTO role_constraint_definition
    FROM pg_constraint
    WHERE conrelid = 'users'::regclass
      AND conname = 'users_role_check';

    IF role_constraint_definition IS NOT NULL
       AND POSITION('OWNER' IN role_constraint_definition) = 0 THEN
        ALTER TABLE users DROP CONSTRAINT users_role_check;
        role_constraint_definition := NULL;
    END IF;

    IF role_constraint_definition IS NULL THEN
        ALTER TABLE users
            ADD CONSTRAINT users_role_check
            CHECK (role IN ('CUSTOMER', 'SELLER', 'RIDER', 'ADMIN', 'OWNER'));
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_products_seller ON products(seller_id);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active);

CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES users(id),
    rider_id UUID REFERENCES users(id),
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN (
            'PENDING', 'CONFIRMED', 'PREPARING',
            'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY',
            'DELIVERED', 'CANCELLED'
        )),
    subtotal NUMERIC(12,2) NOT NULL CHECK (subtotal >= 0),
    delivery_fee NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0),
    total NUMERIC(12,2) NOT NULL CHECK (total >= 0),
    currency CHAR(3) NOT NULL DEFAULT 'USD',
    delivery_address TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DO $$
DECLARE
    role_constraint_definition TEXT;
BEGIN
    SELECT pg_get_constraintdef(oid)
    INTO role_constraint_definition
    FROM pg_constraint
    WHERE conrelid = 'users'::regclass
      AND conname = 'users_role_check';

    IF role_constraint_definition IS NOT NULL
       AND POSITION('OWNER' IN role_constraint_definition) = 0 THEN
        ALTER TABLE users DROP CONSTRAINT users_role_check;
        role_constraint_definition := NULL;
    END IF;

    IF role_constraint_definition IS NULL THEN
        ALTER TABLE users
            ADD CONSTRAINT users_role_check
            CHECK (role IN ('CUSTOMER', 'SELLER', 'RIDER', 'ADMIN', 'OWNER'));
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_rider ON orders(rider_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

CREATE TABLE IF NOT EXISTS order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id),
    product_name VARCHAR(180) NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
    line_total NUMERIC(12,2) NOT NULL CHECK (line_total >= 0)
);

CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id),
    provider VARCHAR(50) NOT NULL,
    provider_reference VARCHAR(180),
    amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
    currency CHAR(3) NOT NULL DEFAULT 'USD',
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED', 'REFUNDED')),
    idempotency_key VARCHAR(180) UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGSERIAL PRIMARY KEY,
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(80) NOT NULL,
    entity_id TEXT,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO categories (name, description)
VALUES
    ('Fresh Produce', 'Fresh fruit and vegetables'),
    ('Groceries', 'Everyday grocery essentials'),
    ('Clothing', 'Clothing and fashion'),
    ('Electronics', 'Electronic products and accessories'),
    ('Household', 'Home and household goods')
ON CONFLICT (name) DO NOTHING;


