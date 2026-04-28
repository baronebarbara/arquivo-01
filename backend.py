import json
import logging
import os
import re
import smtplib
import sqlite3
from email.message import EmailMessage
from datetime import datetime, timedelta
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from flask import Flask, jsonify, request, send_from_directory, session
from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "arquivo01.db")
log = logging.getLogger("arquivo01")

app = Flask(__name__, static_folder=BASE_DIR, static_url_path="")
app.secret_key = os.environ.get("ARQUIVO01_SECRET", "arquivo01-dev-secret")

# Render / Railway: HTTPS termina no proxy; sessão e cookies precisam do esquema real.
if os.environ.get("RENDER") or os.environ.get("RAILWAY_ENVIRONMENT") or os.environ.get("FLY_APP_NAME"):
    from werkzeug.middleware.proxy_fix import ProxyFix

    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)
    app.config["SESSION_COOKIE_SECURE"] = True
    app.config["SESSION_COOKIE_SAMESITE"] = "Lax"


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _ensure_columns(conn):
    """Migrações leves para bases já existentes."""
    def table_columns(table):
        return {row[1] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}

    cols = table_columns("users")
    for name, sql in [
        ("zip_code", "ALTER TABLE users ADD COLUMN zip_code TEXT"),
        ("address_street", "ALTER TABLE users ADD COLUMN address_street TEXT"),
        ("address_number", "ALTER TABLE users ADD COLUMN address_number TEXT"),
        ("address_neighborhood", "ALTER TABLE users ADD COLUMN address_neighborhood TEXT"),
        ("address_city", "ALTER TABLE users ADD COLUMN address_city TEXT"),
        ("address_state", "ALTER TABLE users ADD COLUMN address_state TEXT"),
        ("address_complement", "ALTER TABLE users ADD COLUMN address_complement TEXT"),
    ]:
        if name not in cols:
            conn.execute(sql)

    pc = table_columns("products")
    for name, sql in [
        ("color", "ALTER TABLE products ADD COLUMN color TEXT"),
        ("sizes", "ALTER TABLE products ADD COLUMN sizes TEXT"),
        ("description", "ALTER TABLE products ADD COLUMN description TEXT"),
        ("image_urls", "ALTER TABLE products ADD COLUMN image_urls TEXT"),
        ("availability", "ALTER TABLE products ADD COLUMN availability TEXT DEFAULT 'disponivel'"),
        ("reserved_order_id", "ALTER TABLE products ADD COLUMN reserved_order_id INTEGER"),
        ("reserved_until", "ALTER TABLE products ADD COLUMN reserved_until TEXT"),
        ("stock_by_size", "ALTER TABLE products ADD COLUMN stock_by_size TEXT"),
    ]:
        if name not in pc:
            conn.execute(sql)

    conn.execute("UPDATE products SET availability = 'disponivel' WHERE availability IS NULL OR availability = ''")

    oc = table_columns("order_items")
    if "size_text" not in oc:
        conn.execute("ALTER TABLE order_items ADD COLUMN size_text TEXT")

    ord_cols = table_columns("orders")
    for name, sql in [
        ("mercadopago_preference_id", "ALTER TABLE orders ADD COLUMN mercadopago_preference_id TEXT"),
        ("mercadopago_payment_id", "ALTER TABLE orders ADD COLUMN mercadopago_payment_id TEXT"),
    ]:
        if name not in ord_cols:
            conn.execute(sql)


def init_db():
    conn = get_db()
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            phone TEXT,
            zip_code TEXT,
            address_street TEXT,
            address_number TEXT,
            address_neighborhood TEXT,
            address_city TEXT,
            address_state TEXT,
            address_complement TEXT,
            created_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS products (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            category TEXT NOT NULL,
            price_cents INTEGER NOT NULL,
            image_url TEXT NOT NULL,
            image_urls TEXT,
            availability TEXT NOT NULL DEFAULT "disponivel",
            reserved_order_id INTEGER,
            reserved_until TEXT,
            stock_by_size TEXT,
            color TEXT,
            sizes TEXT,
            description TEXT,
            created_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            customer_name TEXT NOT NULL,
            customer_email TEXT NOT NULL,
            customer_phone TEXT,
            address TEXT NOT NULL,
            city TEXT NOT NULL,
            zip_code TEXT NOT NULL,
            payment_method TEXT NOT NULL,
            subtotal_cents INTEGER NOT NULL,
            discount_cents INTEGER NOT NULL,
            shipping_cents INTEGER NOT NULL,
            total_cents INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'recebido',
            created_at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS order_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER NOT NULL,
            product_id TEXT NOT NULL,
            product_name TEXT NOT NULL,
            unit_price_cents INTEGER NOT NULL,
            quantity INTEGER NOT NULL,
            size_text TEXT,
            FOREIGN KEY(order_id) REFERENCES orders(id)
        )
        """
    )
    _ensure_columns(conn)
    conn.commit()

    count = conn.execute("SELECT COUNT(*) AS total FROM products").fetchone()["total"]
    if count == 0:
        now = datetime.utcnow().isoformat()
        products = [
            (
                "vestido-rose",
                "Vestido Rosé Plissado",
                "Vestido",
                24900,
                "https://images.unsplash.com/photo-1595777457583-95e059d581b8?auto=format&fit=crop&w=900&q=80",
                "Rosé",
                "P,M,G,GG",
                "Vestido plissado com caimento fluido, ideal para eventos e dia a dia elegante. Peça em ótimo estado de conservação.",
                now,
            ),
            (
                "blazer-xadrez",
                "Blazer Xadrez Vintage",
                "Blazer",
                22900,
                "https://images.unsplash.com/photo-1594938298603-c8148c4dae35?auto=format&fit=crop&w=900&q=80",
                "Cinza",
                "P,M,G",
                "Blazer estruturado com padrão xadrez clássico, botões e forro. Ideal para compor com calça de alfaiataria ou jeans escuro.",
                now,
            ),
            (
                "sueter-menta",
                "Suéter Verde Menta",
                "Suéter",
                13900,
                "https://images.unsplash.com/photo-1616690710400-a16d146927c5?auto=format&fit=crop&w=900&q=80",
                "Verde",
                "P,M,G,GG",
                "Tricot macio, gola leve, ótima textura. Peça atemporal e confortável para meia estação.",
                now,
            ),
            (
                "calca-jeans-reta",
                "Calça Jeans Reta",
                "Calça",
                13900,
                "https://images.unsplash.com/photo-1541099649105-f69ad21f3246?auto=format&fit=crop&w=900&q=80",
                "Azul",
                "36,38,40,42",
                "Corte reto, lavagem clássica, bom encaixe no quadril. Medidas reais acima; consulte tabela na página do produto.",
                now,
            ),
            (
                "bolsa-couro",
                "Bolsa Estruturada Couro",
                "Acessório",
                18900,
                "https://images.unsplash.com/photo-1591561954557-26941169b49e?auto=format&fit=crop&w=900&q=80",
                "Marrom",
                "U",
                "Couro com estrutura firme, alça confortável. Itens de acessório usam tamanho único.",
                now,
            ),
            (
                "camisa-offwhite-seda",
                "Camisa Off-White Seda",
                "Blusa",
                19700,
                "https://images.unsplash.com/photo-1583845112203-454497f4f63d?auto=format&fit=crop&w=900&q=80",
                "Off-white",
                "P,M,G,GG",
                "Blusa de seda com caimento leve, gola média, botões forrados. Peça de curadoria, excelente condição geral.",
                now,
            ),
        ]
        conn.executemany(
            """
            INSERT INTO products
            (id, name, category, price_cents, image_url, color, sizes, description, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            products,
        )
        conn.commit()
    _sync_product_metadata(conn)
    conn.close()


def _sync_product_metadata(conn):
    """Garante cor/tamanho/descrição em bases legadas com UPDATE."""
    metadados = {
        "vestido-rose": (
            "Rosé",
            "P,M,G,GG",
            "Vestido plissado com caimento fluido. Peça selecionada, ótima conservação.",
        ),
        "blazer-xadrez": (
            "Cinza",
            "P,M,G",
            "Blazer vintage xadrez, corte clássico, ideal para compor com jeans ou alfaiataria.",
        ),
        "sueter-menta": (
            "Verde",
            "P,M,G,GG",
            "Tricot em tom menta, textura agradável, conforto para o dia a dia.",
        ),
        "calca-jeans-reta": (
            "Azul",
            "36,38,40,42",
            "Corte reto, lavagem atemporal. Tamanho numérico; confira medidas no detalhe da peça.",
        ),
        "bolsa-couro": (
            "Marrom",
            "U",
            "Acessório em couro, estruturado, alça ajustável em bom estado.",
        ),
        "camisa-offwhite-seda": (
            "Off-white",
            "P,M,G,GG",
            "Seda com brilho suave, botões e acabamento alinhado ao brechó de curadoria.",
        ),
    }
    for pid, (cor, tams, desc) in metadados.items():
        conn.execute(
            """
            UPDATE products
            SET color = COALESCE(NULLIF(color, ''), ?),
                sizes = COALESCE(NULLIF(sizes, ''), ?),
                description = COALESCE(NULLIF(description, ''), ?)
            WHERE id = ?
            """,
            (cor, tams, desc, pid),
        )
    conn.commit()


def _require_admin():
    expected = (os.environ.get("ARQUIVO01_ADMIN_KEY", "") or "").strip()
    if not expected:
        return (jsonify({"error": "Admin desativado: defina a variável ARQUIVO01_ADMIN_KEY no servidor."}), 503)
    got = (request.headers.get("X-Admin-Key") or "").strip()
    if got != expected:
        return (jsonify({"error": "Chave de administração inválida."}), 401)
    return None


def _product_id_ok(pid):
    return bool(re.match(r"^[a-z0-9]+(?:-[a-z0-9]+)*$", pid)) and len(pid) <= 80


def parse_stock_by_size(raw, default_sizes=""):
    if isinstance(raw, dict):
        src = raw
    elif isinstance(raw, str) and raw.strip():
        t = raw.strip()
        try:
            j = json.loads(t)
            src = j if isinstance(j, dict) else {}
        except (json.JSONDecodeError, ValueError, TypeError):
            src = {}
            for part in t.split(","):
                if ":" not in part:
                    continue
                k, v = part.split(":", 1)
                src[k.strip()] = v.strip()
    else:
        src = {}

    out = {}
    for k, v in src.items():
        kk = str(k).strip()
        if not kk:
            continue
        try:
            q = int(v)
        except (TypeError, ValueError):
            q = 0
        out[kk] = max(0, q)

    if not out and default_sizes:
        for sz in [x.strip() for x in str(default_sizes).split(",") if x.strip()]:
            out[sz] = 1
    return out


def stock_total(stock_map):
    return sum(max(0, int(v)) for v in (stock_map or {}).values())


def apply_product_availability_by_stock(conn, product_id, stock_map):
    total = stock_total(stock_map)
    if total <= 0:
        conn.execute(
            """
            UPDATE products
            SET availability = 'vendido', reserved_order_id = NULL, reserved_until = NULL
            WHERE id = ?
            """,
            (product_id,),
        )
    else:
        conn.execute(
            """
            UPDATE products
            SET availability = 'disponivel', reserved_order_id = NULL, reserved_until = NULL
            WHERE id = ?
            """,
            (product_id,),
        )


def product_row_to_api(row):
    tamanhos_str = (row["sizes"] or "P,M,G,GG")
    tamanhos = [s.strip() for s in tamanhos_str.split(",") if s.strip()]
    img = row["image_url"]

    imagens = []
    raw_urls = row["image_urls"] if "image_urls" in row.keys() else None
    if raw_urls:
        try:
            parsed = json.loads(raw_urls)
            if isinstance(parsed, list):
                imagens = [str(u).strip() for u in parsed if str(u).strip()]
        except (json.JSONDecodeError, ValueError, TypeError):
            imagens = [u.strip() for u in str(raw_urls).split(",") if u.strip()]
    if not imagens and img:
        imagens = [img]

    raw_stock = row["stock_by_size"] if "stock_by_size" in row.keys() else None
    estoque = parse_stock_by_size(raw_stock, tamanhos_str)

    return {
        "id": row["id"],
        "nome": row["name"],
        "tipo": row["category"],
        "preco": f"R$ {row['price_cents'] / 100:.2f}".replace(".", ","),
        "imagem": imagens[0] if imagens else img,
        "imagens": imagens,
        "cor": row["color"] or "—",
        "tamanhos": tamanhos,
        "descricao": row["description"] or "",
        "disponibilidade": row["availability"] if "availability" in row.keys() and row["availability"] else "disponivel",
        "estoque_por_tamanho": estoque,
    }


def reservation_minutes():
    try:
        mins = int((os.environ.get("RESERVA_PAGAMENTO_MINUTOS") or "30").strip())
    except (TypeError, ValueError, AttributeError):
        mins = 30
    return max(5, min(mins, 24 * 60))


def liberar_reservas_expiradas(conn):
    limite = (datetime.utcnow() - timedelta(minutes=reservation_minutes())).isoformat()
    exp = conn.execute(
        """
        SELECT id FROM orders
        WHERE status = 'aguardando_pagamento' AND created_at <= ?
        """,
        (limite,),
    ).fetchall()
    if not exp:
        return 0
    ids = [int(r["id"]) for r in exp]
    for oid in ids:
        conn.execute("UPDATE orders SET status = 'cancelado' WHERE id = ? AND status = 'aguardando_pagamento'", (oid,))

        itens = conn.execute(
            "SELECT product_id, quantity, size_text FROM order_items WHERE order_id = ?",
            (oid,),
        ).fetchall()
        for it in itens:
            pid = str(it["product_id"] or "").strip()
            qty = int(it["quantity"] or 0)
            size = str(it["size_text"] or "").strip()
            if not pid or qty <= 0 or not size:
                continue
            prow = conn.execute("SELECT stock_by_size, sizes FROM products WHERE id = ?", (pid,)).fetchone()
            if not prow:
                continue
            stock_map = parse_stock_by_size(prow["stock_by_size"], prow["sizes"] or "")
            stock_map[size] = max(0, int(stock_map.get(size, 0))) + qty
            conn.execute(
                "UPDATE products SET stock_by_size = ? WHERE id = ?",
                (json.dumps(stock_map, ensure_ascii=False), pid),
            )
            apply_product_availability_by_stock(conn, pid, stock_map)

        conn.execute(
            """
            UPDATE products
            SET availability = 'disponivel',
                reserved_order_id = NULL,
                reserved_until = NULL
            WHERE reserved_order_id = ? AND availability = 'reservado'
            """,
            (oid,),
        )
    conn.commit()
    return len(ids)


def user_to_dict(row):
    chaves = row.keys()
    d = {
        "id": row["id"],
        "name": row["name"],
        "email": row["email"],
        "phone": row["phone"] or None,
    }
    for chave in (
        "zip_code",
        "address_street",
        "address_number",
        "address_neighborhood",
        "address_city",
        "address_state",
        "address_complement",
    ):
        d[chave] = row[chave] if chave in chaves else None
    return d


def _smtp_send_message(msg: EmailMessage) -> bool:
    host = (os.environ.get("SMTP_HOST") or "").strip()
    if not host:
        log.warning("E-mail desativado: defina SMTP_HOST (ex.: no Render, Environment).")
        return False
    port = int(os.environ.get("SMTP_PORT", "587") or 587)
    use_ssl = (os.environ.get("SMTP_SSL", "") or "").strip().lower() in ("1", "true", "yes")
    smtp_user = (os.environ.get("SMTP_USER") or "").strip()
    smtp_pass = (os.environ.get("SMTP_PASS") or "").strip()
    try:
        if use_ssl:
            with smtplib.SMTP_SSL(host, port, timeout=30) as s:
                if smtp_user and smtp_pass:
                    s.login(smtp_user, smtp_pass)
                s.send_message(msg)
        else:
            with smtplib.SMTP(host, port, timeout=30) as s:
                s.starttls()
                if smtp_user and smtp_pass:
                    s.login(smtp_user, smtp_pass)
                s.send_message(msg)
        return True
    except (OSError, smtplib.SMTPException) as e:
        log.warning("Falha ao enviar e-mail (SMTP): %s", e)
        return False


def send_welcome_email(to_addr, name):
    if not (os.environ.get("SMTP_HOST") or "").strip():
        return
    smtp_user = (os.environ.get("SMTP_USER") or "").strip()
    from_addr = (os.environ.get("SMTP_FROM") or smtp_user).strip()
    if not from_addr:
        log.warning("Defina SMTP_FROM ou SMTP_USER para enviar o e-mail de boas-vindas.")
        return
    msg = EmailMessage()
    msg["Subject"] = "Bem-vinda(o) ao Arquivo 01"
    msg["From"] = from_addr
    msg["To"] = to_addr
    bcc = (os.environ.get("SMTP_BCC") or "").strip()
    if bcc:
        msg["Bcc"] = bcc
    msg.set_content(
        f"Ola, {name}.\n\n"
        f"Sua conta no Arquivo 01 foi criada com sucesso.\n\n"
        f"Obrigada por fazer parte da nossa curadoria.\n"
        f"Equipe Arquivo 01"
    )
    _smtp_send_message(msg)


def send_order_confirmation_email(to_addr, customer_name, order_id, total_label, itens_resumo: str):
    if not (os.environ.get("SMTP_HOST") or "").strip():
        return
    smtp_user = (os.environ.get("SMTP_USER") or "").strip()
    from_addr = (os.environ.get("SMTP_FROM") or smtp_user).strip()
    if not from_addr:
        return
    oid = int(order_id)
    msg = EmailMessage()
    msg["Subject"] = f"Arquivo 01 - Pedido A01-{oid:04d} registrado"
    msg["From"] = from_addr
    msg["To"] = to_addr
    bcc = (os.environ.get("SMTP_BCC") or "").strip()
    if bcc:
        msg["Bcc"] = bcc
    corpo = (
        f"Ola, {customer_name}.\n\n"
        f"Seu pedido nº A01-{oid:04d} foi registrado (total {total_label}).\n\n"
        f"Itens:\n{itens_resumo or '(ver site)'}\n\n"
        f"O pagamento segue o fluxo do checkout (Mercado Pago). Voce tambem pode acompanhar o status em Minha Conta no site.\n\n"
        f"Obrigada pela preferencia.\n"
        f"Arquivo 01 - Curadoria e Brecho"
    )
    msg.set_content(corpo)
    _smtp_send_message(msg)


def parse_brl_to_cents(valor):
    if isinstance(valor, (int, float)):
        return int(round(float(valor) * 100))
    texto = str(valor or "").replace("R$", "").replace(".", "").replace(",", ".").strip()
    try:
        return int(round(float(texto) * 100))
    except ValueError:
        return 0


def public_base_url():
    env = (os.environ.get("PUBLIC_BASE_URL", "") or "").strip().rstrip("/")
    if env:
        return env
    return (request.url_root or "http://127.0.0.1:8000/").rstrip("/")


def _mp_request_json(url, body=None, method="GET"):
    token = (os.environ.get("MERCADOPAGO_ACCESS_TOKEN", "") or "").strip()
    if not token:
        return None, "MERCADOPAGO_ACCESS_TOKEN não configurado"
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        req = Request(
            url,
            data=data,
            method=method,
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
        )
    else:
        req = Request(
            url,
            method=method,
            headers={"Authorization": f"Bearer {token}"},
        )
    try:
        with urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8")), None
    except HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace") if e.fp else ""
        return None, f"Mercado Pago: HTTP {e.code} {err_body[:400]}"
    except (URLError, TimeoutError, json.JSONDecodeError, ValueError) as e:
        return None, f"Mercado Pago: {e}"


def mercado_pago_criar_preferencia(
    order_id, total_cents, payer_email, customer_name, customer_phone
):
    base = public_base_url()
    unit = round(total_cents / 100.0, 2)
    if unit <= 0:
        return None, "Total inválido."
    pay_email = (payer_email or "").strip()
    body = {
        "items": [
            {
                "title": f"Arquivo 01 - Pedido #{order_id}"[:256],
                "description": "Loja de curadoria e brechó",
                "quantity": 1,
                "unit_price": unit,
                "currency_id": "BRL",
            }
        ],
        "external_reference": str(order_id),
        "back_urls": {
            "success": f"{base}/pedido-pagamento.html?status=success&order_id={order_id}",
            "failure": f"{base}/pedido-pagamento.html?status=failure&order_id={order_id}",
            "pending": f"{base}/pedido-pagamento.html?status=pending&order_id={order_id}",
        },
        "auto_return": "approved",
    }
    wurl = f"{base}/api/webhooks/mercadopago"
    if not base.startswith("http://127.0.0.1") and not base.startswith("http://localhost"):
        body["notification_url"] = wurl
    if pay_email or (customer_name or "").strip():
        payer = {}
        if pay_email:
            payer["email"] = pay_email
        if (customer_name or "").strip():
            payer["name"] = (customer_name or "")[:256]
        body["payer"] = payer
    data, err = _mp_request_json(
        "https://api.mercadopago.com/checkout/preferences", body=body, method="POST"
    )
    if err:
        return None, err
    return data, None


def mercado_pago_sincronizar_pagamento(payment_id):
    """Atualiza pedido a partir de um ID de pagamento (webhook / consulta)."""
    pid = str(payment_id)
    if not pid.isdigit():
        return
    j, err = _mp_request_json(f"https://api.mercadopago.com/v1/payments/{pid}", method="GET")
    if err or not j:
        return
    st = (j.get("status") or "").lower()
    if st not in ("approved", "accredited"):
        return
    ext = j.get("external_reference")
    if ext is None:
        return
    try:
        oid = int(str(ext).strip())
    except ValueError:
        return
    conn = get_db()
    conn.execute(
        """
        UPDATE orders
        SET status = 'pago', mercadopago_payment_id = COALESCE(mercadopago_payment_id, ?)
        WHERE id = ?
        """,
        (pid, oid),
    )
    conn.execute(
        """
        UPDATE products
        SET availability = 'vendido',
            reserved_order_id = NULL,
            reserved_until = NULL
        WHERE reserved_order_id = ?
        """,
        (oid,),
    )
    conn.commit()
    conn.close()


@app.post("/api/register")
def register():
    payload = request.get_json(silent=True) or {}
    name = (payload.get("name") or "").strip()
    email = (payload.get("email") or "").strip().lower()
    password = payload.get("password") or ""
    phone = (payload.get("phone") or "").strip()
    zip_code = (payload.get("zip_code") or "").strip()
    address_street = (payload.get("address_street") or "").strip()
    address_number = (payload.get("address_number") or "").strip()
    address_neighborhood = (payload.get("address_neighborhood") or "").strip()
    address_city = (payload.get("address_city") or "").strip()
    address_state = (payload.get("address_state") or "").strip()
    address_complement = (payload.get("address_complement") or "").strip() or None

    if not name or not email or len(password) < 6:
        return jsonify({"error": "Preencha nome, e-mail e senha (mín. 6 caracteres)."}), 400
    if not all([zip_code, address_street, address_number, address_neighborhood, address_city, address_state]):
        return jsonify({"error": "Preencha o endereço completo (CEP, rua, número, bairro, cidade e UF)."}), 400

    conn = get_db()
    existing = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
    if existing:
        conn.close()
        return jsonify({"error": "Este e-mail já está cadastrado."}), 409

    conn.execute(
        """
        INSERT INTO users (
            name, email, password_hash, phone, zip_code, address_street, address_number,
            address_neighborhood, address_city, address_state, address_complement, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            name,
            email,
            generate_password_hash(password, method="pbkdf2:sha256"),
            phone,
            zip_code,
            address_street,
            address_number,
            address_neighborhood,
            address_city,
            address_state,
            address_complement,
            datetime.utcnow().isoformat(),
        ),
    )
    conn.commit()
    user = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    conn.close()

    session["user_id"] = user["id"]
    send_welcome_email(email, name)
    return jsonify({"user": user_to_dict(user)})


@app.post("/api/login")
def login():
    payload = request.get_json(silent=True) or {}
    email = (payload.get("email") or "").strip().lower()
    password = payload.get("password") or ""
    conn = get_db()
    user = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    conn.close()

    if not user or not check_password_hash(user["password_hash"], password):
        return jsonify({"error": "E-mail ou senha inválidos."}), 401

    session["user_id"] = user["id"]
    return jsonify({"user": user_to_dict(user)})


@app.post("/api/logout")
def logout():
    session.pop("user_id", None)
    return jsonify({"ok": True})


@app.get("/api/me")
def me():
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"user": None})

    conn = get_db()
    user = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    conn.close()
    if not user:
        return jsonify({"user": None})
    return jsonify({"user": user_to_dict(user)})


@app.get("/api/products")
def list_products():
    conn = get_db()
    liberar_reservas_expiradas(conn)
    rows = conn.execute("SELECT * FROM products WHERE availability = 'disponivel' ORDER BY created_at DESC").fetchall()
    conn.close()
    return jsonify({"products": [product_row_to_api(row) for row in rows]})


@app.get("/api/product/<product_id>")
def get_product(product_id):
    conn = get_db()
    liberar_reservas_expiradas(conn)
    row = conn.execute("SELECT * FROM products WHERE id = ? AND availability = 'disponivel'", (product_id,)).fetchone()
    conn.close()
    if not row:
        return jsonify({"error": "Peça não encontrada ou indisponível."}), 404
    return jsonify({"product": product_row_to_api(row)})


@app.get("/api/admin/status")
def admin_status():
    return jsonify(
        {
            "admin_configured": bool((os.environ.get("ARQUIVO01_ADMIN_KEY", "") or "").strip()),
        }
    )


@app.get("/api/admin/products")
def admin_list_products():
    err = _require_admin()
    if err:
        return err
    conn = get_db()
    liberar_reservas_expiradas(conn)
    rows = conn.execute("SELECT * FROM products ORDER BY created_at DESC").fetchall()
    conn.close()
    return jsonify({"products": [product_row_to_api(row) for row in rows]})


@app.post("/api/admin/products")
def admin_create_product():
    err = _require_admin()
    if err:
        return err
    payload = request.get_json(silent=True) or {}
    pid = (payload.get("id") or "").strip().lower()
    name = (payload.get("name") or "").strip()
    category = (payload.get("category") or "").strip()
    image_url = (payload.get("image_url") or "").strip()
    color = (payload.get("color") or "—").strip() or "—"
    sizes = (payload.get("sizes") or "P,M,G,GG").strip()
    description = (payload.get("description") or "").strip()
    stock_by_size = parse_stock_by_size(payload.get("stock_by_size"), sizes)

    raw_image_urls = payload.get("image_urls")
    image_urls = []
    if isinstance(raw_image_urls, list):
        image_urls = [str(u).strip() for u in raw_image_urls if str(u).strip()]
    elif isinstance(raw_image_urls, str) and raw_image_urls.strip():
        image_urls = [u.strip() for u in raw_image_urls.split(",") if u.strip()]

    if image_url:
        image_urls = [image_url, *[u for u in image_urls if u != image_url]]

    if not _product_id_ok(pid):
        return jsonify(
            {
                "error": "ID inválido. Use só letras minúsculas, números e hífens (ex.: vestido-floral-01).",
            }
        ), 400
    if not name or not category:
        return jsonify({"error": "Preencha nome e categoria."}), 400
    if stock_total(stock_by_size) <= 0:
        return jsonify({"error": "Informe estoque por tamanho com quantidade maior que zero."}), 400
    if not image_urls:
        return jsonify({"error": "Informe ao menos 1 URL de imagem."}), 400

    for u in image_urls:
        if not u.startswith("http://") and not u.startswith("https://"):
            return jsonify({"error": "As imagens precisam de URL http(s) pública."}), 400

    image_urls = image_urls[:3]
    image_url = image_urls[0]

    price_cents = payload.get("price_cents")
    if price_cents is not None:
        try:
            price_cents = int(price_cents)
        except (TypeError, ValueError):
            return jsonify({"error": "Preço (centavos) inválido."}), 400
    else:
        price_cents = parse_brl_to_cents(payload.get("price_brl") or "0")
    if price_cents <= 0:
        return jsonify({"error": "Informe um preço maior que zero."}), 400

    now = datetime.utcnow().isoformat()
    conn = get_db()
    try:
        if conn.execute("SELECT 1 FROM products WHERE id = ?", (pid,)).fetchone():
            return jsonify({"error": "Já existe uma peça com este ID. Use outro slug."}), 409
        conn.execute(
            """
            INSERT INTO products
            (id, name, category, price_cents, image_url, image_urls, availability, reserved_order_id, reserved_until, stock_by_size, color, sizes, description, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (pid, name, category, price_cents, image_url, json.dumps(image_urls, ensure_ascii=False), "disponivel", None, None, json.dumps(stock_by_size, ensure_ascii=False), color, sizes, description, now),
        )
        _sync_product_metadata(conn)
        conn.commit()
    finally:
        conn.close()
    return jsonify({"ok": True, "id": pid})


@app.delete("/api/admin/products/<product_id>")
def admin_delete_product(product_id):
    err = _require_admin()
    if err:
        return err
    pid = (product_id or "").strip()
    if not pid:
        return jsonify({"error": "ID inválido."}), 400
    conn = get_db()
    cur = conn.execute("DELETE FROM products WHERE id = ?", (pid,))
    conn.commit()
    n = cur.rowcount
    conn.close()
    if n == 0:
        return jsonify({"error": "Peça não encontrada."}), 404
    return jsonify({"ok": True})


@app.get("/api/cep/<cep_raw>")
def buscar_cep(cep_raw):
    cep = "".join(c for c in cep_raw or "" if c.isdigit())
    if len(cep) != 8:
        return jsonify({"error": "CEP inválido (use 8 dígitos)."}), 400
    try:
        with urlopen(f"https://viacep.com.br/ws/{cep}/json/", timeout=6) as resp:
            j = json.loads(resp.read().decode("utf-8"))
    except (URLError, TimeoutError, json.JSONDecodeError, ValueError):
        return jsonify({"error": "Não foi possível consultar o CEP. Tente novamente."}), 502
    if j.get("erro"):
        return jsonify({"error": "CEP não encontrado."}), 404
    return jsonify(
        {
            "zip_code": j.get("cep", ""),
            "address_street": j.get("logradouro", ""),
            "address_neighborhood": j.get("bairro", ""),
            "address_city": j.get("localidade", ""),
            "address_state": j.get("uf", ""),
        }
    )


def _opcoes_frete_estimativa(cep8: str):
    """
    Estimativas de frete (referência) por região do CEP.
    Pode ser substituída por cálculo real (Correios com contrato, Melhor Envio, etc.).
    """
    p = int(cep8[:2])
    if p <= 19:
        base, prazo = 16, 2
    elif p <= 39:
        base, prazo = 22, 3
    elif p <= 69:
        base, prazo = 28, 5
    else:
        base, prazo = 34, 7
    return {
        "cep_destino": cep8,
        "opcoes": [
            {
                "id": "economica",
                "nome": "Econômica (estimativa, envio padrão)",
                "valor": round(base * 0.9, 2),
                "prazo_dias": prazo + 3,
            },
            {
                "id": "padrao",
                "nome": "Padrão (estimativa, mais rápido)",
                "valor": round(base * 1.08, 2),
                "prazo_dias": max(1, prazo),
            },
        ],
        "nota": "Valores e prazos são simulações. Integração com API dos Correios (contrato) ou plataformas (ex.: Melhor Envio) pode substituir este endpoint.",
    }


@app.get("/api/frete-estimativa/<cep_raw>")
def frete_estimativa(cep_raw):
    cep = "".join(c for c in cep_raw or "" if c.isdigit())
    if len(cep) != 8:
        return jsonify({"error": "CEP inválido (8 dígitos)."}), 400
    return jsonify(_opcoes_frete_estimativa(cep))


@app.post("/api/orders")
def create_order():
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"error": "Faça login para finalizar a compra."}), 401

    payload = request.get_json(silent=True) or {}
    items = payload.get("items") or []
    if not items:
        return jsonify({"error": "Carrinho vazio."}), 400

    customer_name = (payload.get("customer_name") or "").strip()
    customer_email = (payload.get("customer_email") or "").strip()
    customer_phone = (payload.get("customer_phone") or "").strip()
    address = (payload.get("address") or "").strip()
    city = (payload.get("city") or "").strip()
    zip_code = (payload.get("zip_code") or "").strip()
    payment_method = (payload.get("payment_method") or "").strip()

    if not all([customer_name, customer_email, address, city, zip_code, payment_method]):
        return jsonify({"error": "Preencha os dados obrigatórios do checkout."}), 400

    subtotal_cents = parse_brl_to_cents(payload.get("subtotal"))
    discount_cents = parse_brl_to_cents(payload.get("discount"))
    shipping_cents = parse_brl_to_cents(payload.get("shipping"))
    total_cents = parse_brl_to_cents(payload.get("total"))
    if total_cents <= 0:
        total_cents = max(subtotal_cents - discount_cents + shipping_cents, 0)

    payment_stored = "mercadopago"

    conn = get_db()
    liberar_reservas_expiradas(conn)

    item_ids = []
    for item in items:
        pid = str(item.get("id") or "").strip()
        if not pid:
            conn.close()
            return jsonify({"error": "Item inválido: id ausente."}), 400
        if pid in item_ids:
            conn.close()
            return jsonify({"error": f"Peça repetida no pedido: {pid}."}), 400
        item_ids.append(pid)

    marks = ",".join(["?"] * len(item_ids))
    rows_prod = conn.execute(
        f"SELECT id, availability FROM products WHERE id IN ({marks})",
        item_ids,
    ).fetchall()
    m = {r["id"]: (r["availability"] or "disponivel") for r in rows_prod}
    missing = [pid for pid in item_ids if pid not in m]
    if missing:
        conn.close()
        return jsonify({"error": f"Peça(s) não encontrada(s): {', '.join(missing)}."}), 404
    indisponiveis = [pid for pid in item_ids if m.get(pid) != "disponivel"]
    if indisponiveis:
        conn.close()
        return jsonify({"error": f"Peça(s) indisponível(is): {', '.join(indisponiveis)}."}), 409

    # Confere estoque por tamanho
    for item in items:
        pid = str(item.get("id") or "").strip()
        size = str((item.get("tamanho") or item.get("size") or "Único") or "Único").strip()
        qty = int(item.get("quantidade") or 1)
        prow = conn.execute("SELECT stock_by_size, sizes FROM products WHERE id = ?", (pid,)).fetchone()
        if not prow:
            conn.close()
            return jsonify({"error": f"Peça {pid} não encontrada."}), 404
        stock_map = parse_stock_by_size(prow["stock_by_size"], prow["sizes"] or "")
        disponivel = int(stock_map.get(size, 0))
        if qty > disponivel:
            conn.close()
            return jsonify({"error": f"Estoque insuficiente para {pid} tam. {size}. Disponível: {disponivel}."}), 409

    cursor = conn.cursor()
    agora = datetime.utcnow()
    cursor.execute(
        """
        INSERT INTO orders (
            user_id, customer_name, customer_email, customer_phone, address, city, zip_code,
            payment_method, subtotal_cents, discount_cents, shipping_cents, total_cents, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            user_id,
            customer_name,
            customer_email,
            customer_phone,
            address,
            city,
            zip_code,
            payment_stored,
            subtotal_cents,
            discount_cents,
            shipping_cents,
            total_cents,
            "aguardando_pagamento",
            agora.isoformat(),
        ),
    )
    order_id = cursor.lastrowid
    for item in items:
        tamanho = (item.get("tamanho") or item.get("size") or "Único") or "Único"
        cursor.execute(
            """
            INSERT INTO order_items (order_id, product_id, product_name, unit_price_cents, quantity, size_text)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                order_id,
                item.get("id"),
                item.get("nome"),
                parse_brl_to_cents(item.get("preco")),
                int(item.get("quantidade") or 1),
                str(tamanho),
            ),
        )

    reservado_ate = (agora + timedelta(minutes=reservation_minutes())).isoformat()
    for item in items:
        pid = str(item.get("id") or "").strip()
        size = str((item.get("tamanho") or item.get("size") or "Único") or "Único").strip()
        qty = int(item.get("quantidade") or 1)

        prow = conn.execute("SELECT stock_by_size, sizes FROM products WHERE id = ?", (pid,)).fetchone()
        stock_map = parse_stock_by_size(prow["stock_by_size"], prow["sizes"] or "") if prow else {}
        if stock_map:
            atual = int(stock_map.get(size, 0))
            if qty > atual:
                conn.execute("UPDATE orders SET status = 'cancelado' WHERE id = ?", (order_id,))
                conn.commit()
                conn.close()
                return jsonify({"error": f"A peça {pid} tam. {size} acabou de ficar indisponível."}), 409
            stock_map[size] = max(0, atual - qty)
            conn.execute(
                "UPDATE products SET stock_by_size = ? WHERE id = ?",
                (json.dumps(stock_map, ensure_ascii=False), pid),
            )
            apply_product_availability_by_stock(conn, pid, stock_map)
        else:
            # fallback para peças legadas sem estoque por tamanho
            cur = conn.execute(
                """
                UPDATE products
                SET availability = 'reservado',
                    reserved_order_id = ?,
                    reserved_until = ?
                WHERE id = ? AND availability = 'disponivel'
                """,
                (order_id, reservado_ate, pid),
            )
            if cur.rowcount == 0:
                conn.execute("UPDATE orders SET status = 'cancelado' WHERE id = ?", (order_id,))
                conn.commit()
                conn.close()
                return jsonify({"error": f"A peça {pid} acabou de ficar indisponível. Atualize o carrinho e tente novamente."}), 409

    conn.commit()

    tot_label = f"R$ {total_cents / 100:.2f}".replace(".", ",")
    linhas_itens = []
    for it in items:
        q = int(it.get("quantidade") or 1)
        nm = (it.get("nome") or "?")[:200]
        linhas_itens.append(f"  - {nm} x{q}")
    send_order_confirmation_email(
        customer_email,
        customer_name,
        order_id,
        tot_label,
        "\n".join(linhas_itens) if linhas_itens else "",
    )

    mp_err = None
    pref, mp_err = mercado_pago_criar_preferencia(
        order_id,
        total_cents,
        customer_email,
        customer_name,
        customer_phone,
    )
    mercado_pago = None
    if pref and pref.get("id"):
        cursor.execute(
            "UPDATE orders SET mercadopago_preference_id = ? WHERE id = ?",
            (str(pref["id"]), order_id),
        )
        use_sbx = (os.environ.get("MERCADOPAGO_SANDBOX", "1") or "1") == "1"
        init_pt = pref.get("init_point")
        sand_pt = pref.get("sandbox_init_point")
        if use_sbx:
            redirect_url = sand_pt or init_pt
        else:
            redirect_url = init_pt or sand_pt
        if isinstance(redirect_url, str):
            redirect_url = redirect_url.strip() or None
        if not redirect_url and not mp_err:
            mp_err = "Mercado Pago não retornou o link (init_point). Verifique o token e a conta."
        mercado_pago = {
            "preference_id": pref.get("id"),
            "init_point": init_pt,
            "sandbox_init_point": sand_pt,
            "use_sandbox": use_sbx,
            "redirect_url": redirect_url,
        }
    elif not (os.environ.get("MERCADOPAGO_ACCESS_TOKEN", "") or "").strip():
        mp_err = "Configure MERCADOPAGO_ACCESS_TOKEN para gerar o link de pagamento."
    conn.commit()
    conn.close()

    out = {
        "order_id": order_id,
        "status": "aguardando_pagamento",
    }
    if mercado_pago:
        out["mercadopago"] = mercado_pago
    if mp_err:
        out["mercadopago_error"] = mp_err
    return jsonify(out)


@app.get("/api/orders")
def list_orders():
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"orders": []})

    try:
        limit = int(request.args.get("limit", 10))
    except (TypeError, ValueError):
        limit = 10
    limit = max(1, min(limit, 100))

    conn = get_db()
    liberar_reservas_expiradas(conn)
    rows = conn.execute(
        """
        SELECT id, status, total_cents, created_at
        FROM orders
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT ?
        """,
        (user_id, limit),
    ).fetchall()
    conn.close()
    orders = [
        {
            "id": row["id"],
            "status": row["status"],
            "total": f"R$ {row['total_cents'] / 100:.2f}".replace(".", ","),
            "created_at": row["created_at"],
        }
        for row in rows
    ]
    return jsonify({"orders": orders})


@app.route("/api/webhooks/mercadopago", methods=["GET", "POST"])
def mp_webhook():
    pay_id = None
    if request.method == "GET":
        t = (request.args.get("topic") or request.args.get("type") or "").lower()
        if t in ("payment", "merchant_order", "mp-connect"):
            pay_id = request.args.get("id") or request.args.get("data.id")
    else:
        j = request.get_json(silent=True) or {}
        if (j.get("type") or "").lower() == "payment" and (j.get("data") or {}).get("id"):
            pay_id = (j.get("data") or {}).get("id")
        elif (j.get("action") or "").lower() in ("payment.updated", "payment.created"):
            rid = (j.get("data") or {}).get("id")
            if rid:
                pay_id = rid
    if pay_id is not None:
        mercado_pago_sincronizar_pagamento(str(pay_id))
    return jsonify({"ok": True}), 200


@app.get("/")
def root():
    return send_from_directory(BASE_DIR, "index.html")


@app.get("/<path:path>")
def static_files(path):
    return send_from_directory(BASE_DIR, path)


init_db()

if __name__ == "__main__":
    app.run(debug=True, port=8000)
