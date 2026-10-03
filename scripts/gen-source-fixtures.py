#!/usr/bin/env python3
"""
Synthetic fixture generator for Ryan's sources lane (docs/interfaces.md §1).
Deterministic (seeded), fake data only. Writes into data/fixtures/<source_id>/
under the repo root passed as argv[1].

Deliberate messy cases (required by interfaces.md):
  - Amazon monthly: disclaimer/preamble lines above the real header.
  - A refund row (Amazon monthly, FedEx monthly).
  - An order near midnight Eastern (ShopGoodwill daily 2026-10-02, 00:05 ET).
  - A renamed column (eBay daily 2026-10-03: "Sold For" -> "Sale Amount").
  - Upright <-> eBay duplicate: same channel_order_id/item on 2026-10-02.
"""
import csv
import io
import os
import random
import sys
from datetime import datetime, timedelta

try:
    from openpyxl import Workbook
except ImportError:
    Workbook = None

root = sys.argv[1]
fx = os.path.join(root, "data", "fixtures")
rng = random.Random(20260903)

FAKE_FIRST = ["Alex", "Jordan", "Taylor", "Sam", "Casey", "Morgan", "Riley", "Jamie",
              "Drew", "Avery", "Quinn", "Skyler", "Reese", "Hayden", "Parker"]
CATEGORIES = ["Electronics", "Home Goods", "Apparel", "Books & Media", "Toys",
              "Furniture", "Jewelry", "Sporting Goods"]

def write_csv(path, header, rows, preamble=None):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        if preamble:
            for line in preamble:
                f.write(line + "\n")
        w = csv.writer(f)
        w.writerow(header)
        for r in rows:
            w.writerow(r)

def write_xlsx(path, header, rows):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if Workbook is None:
        # fallback: write as .csv with .xlsx-ish note if openpyxl unavailable
        write_csv(path.replace(".xlsx", ".csv"), header, rows)
        return
    wb = Workbook()
    ws = wb.active
    ws.append(header)
    for r in rows:
        ws.append(r)
    wb.save(path)

def money(cents):
    return f"{cents/100:.2f}"

def fake_buyer_id(i):
    return f"BYR-{1000+i}"

# ---------------------------------------------------------------------------
# Amazon — monthly, Date Range Transaction Report, preamble lines + refund
# ---------------------------------------------------------------------------
amazon_header = ["date/time", "settlement id", "type", "order id", "sku",
                 "description", "quantity", "marketplace", "fulfillment",
                 "product sales", "product sales tax", "shipping credits",
                 "shipping credits tax", "marketplace withheld tax",
                 "selling fees", "other transaction fees", "total"]
amazon_rows = []
for i in range(28):
    day = 1 + (i % 28)
    oid = f"11{i%2}-{2200000+i}-{3344556+i}"
    gross = rng.randint(800, 6500)
    tax = round(gross * 0.07)
    ship = rng.randint(0, 650)
    fee = -round(gross * 0.15)
    total = gross + tax + ship + fee
    amazon_rows.append([
        f"2026-09-{day:02d} {8+(i%10):02d}:{(i*7)%60:02d}:00", f"S-{90000+i}",
        "Order", oid, f"SKU-{1000+i}", "Donated goods — mixed lot", 1,
        "ATVPDKIKX0DER", "MFN", money(gross), money(tax), money(ship), "0.00",
        money(-tax), money(fee), "0.00", money(total),
    ])
# the required refund row — reverses order #5
ref_gross = -amazon_rows[5][9] if False else None
g5 = float(amazon_rows[5][9])
amazon_rows.insert(6, [
    "2026-09-07 15:22:00", "S-90099", "Refund", amazon_rows[5][3], amazon_rows[5][4],
    "Donated goods — mixed lot", 1, "ATVPDKIKX0DER", "MFN",
    money(-int(g5*100)), "0.00", "0.00", "0.00", "0.00", "0.00", "0.00",
    money(-int(g5*100)),
])
preamble = [
    "Amazon Seller Central — Date Range Transaction Report",
    "This report may contain time-sensitive information. Values are estimates until settlement.",
    "Generated 2026-10-01 09:14 UTC for account GOODWILL-MICHIANA-ECOM",
    "",
]
write_csv(os.path.join(fx, "amazon", "amazon_2026-09.csv"), amazon_header, amazon_rows, preamble)

# ---------------------------------------------------------------------------
# eBay — monthly Orders report + 3 daily files (incl. renamed column + dup)
# ---------------------------------------------------------------------------
ebay_header = ["Sales Record Number", "Order Number", "Buyer Username", "Item Number",
               "Item Title", "Quantity", "Sold For", "Shipping And Handling",
               "eBay Collected Tax", "Total Price", "Sale Date", "Paid On Date"]

def ebay_row(i, day, order_no=None):
    sold = rng.randint(500, 7000)
    ship = rng.randint(0, 800)
    tax = round(sold * 0.06)
    total = sold + ship + tax
    order_no = order_no or f"03-{8800000+i}"
    return [4400 + i, order_no, f"buyer_{rng.choice(FAKE_FIRST).lower()}{i}",
            f"3{30000000+i}", f"{rng.choice(CATEGORIES)} lot #{i}", 1,
            money(sold), money(ship), money(tax), money(total),
            f"2026-09-{day:02d}", f"2026-09-{day:02d}"], order_no

ebay_rows = []
for i in range(24):
    row, _ = ebay_row(i, 1 + (i % 28))
    ebay_rows.append(row)
write_csv(os.path.join(fx, "ebay", "ebay_2026-09.csv"), ebay_header, ebay_rows)

# daily 10-01: normal
d1_rows = []
for i in range(6):
    row, _ = ebay_row(100 + i, 1)
    d1_rows.append(row)
write_csv(os.path.join(fx, "ebay", "ebay_2026-10-01.csv"), ebay_header, d1_rows)

# daily 10-02: includes the order that Upright will also report (duplicate)
d2_rows = []
dup_order_no = "03-8899001"
for i in range(5):
    row, _ = ebay_row(200 + i, 2)
    d2_rows.append(row)
dup_row, _ = ebay_row(205, 2, order_no=dup_order_no)
d2_rows.append(dup_row)
write_csv(os.path.join(fx, "ebay", "ebay_2026-10-02.csv"), ebay_header, d2_rows)

# daily 10-03: renamed column messy case ("Sold For" -> "Sale Amount")
ebay_header_renamed = [h if h != "Sold For" else "Sale Amount" for h in ebay_header]
d3_rows = []
for i in range(5):
    row, _ = ebay_row(300 + i, 3)
    d3_rows.append(row)
write_csv(os.path.join(fx, "ebay", "ebay_2026-10-03.csv"), ebay_header_renamed, d3_rows)

# ---------------------------------------------------------------------------
# ShopGoodwill — monthly + 3 daily (incl. midnight-Eastern-boundary order)
# ---------------------------------------------------------------------------
sg_header = ["Item ID", "Title", "Category", "End Date", "Winning Bid", "Shipping",
             "Handling", "Seller Fee", "Net", "Buyer ID", "Status", "Period"]

def sg_row(i, day, end_dt=None):
    bid = rng.randint(500, 5000)
    ship = rng.randint(400, 1200)
    hand = 150
    fee = -round(bid * 0.09)
    net = bid + ship + hand + fee
    end_dt = end_dt or f"2026-09-{day:02d}"
    period = "Period 1" if day <= 15 else "Period 3"
    return [f"SG-{88100+i}", f"{rng.choice(CATEGORIES)} item #{i}",
            rng.choice(CATEGORIES), end_dt, money(bid), money(ship), money(hand),
            money(fee), money(net), fake_buyer_id(i), "Sold", period]

sg_rows = [sg_row(i, 1 + (i % 28)) for i in range(20)]
write_csv(os.path.join(fx, "shopgoodwill", "shopgoodwill_2026-09.csv"), sg_header, sg_rows)

write_csv(os.path.join(fx, "shopgoodwill", "shopgoodwill_2026-10-01.csv"), sg_header,
          [sg_row(100 + i, 1) for i in range(5)])

# midnight-Eastern-boundary order: 2026-10-02T04:05:00Z == 2026-10-02 00:05 America/Indiana/Indianapolis
mb_rows = [sg_row(200 + i, 2) for i in range(4)]
mb_rows.append(sg_row(250, 2, end_dt="2026-10-02T04:05:00Z"))
write_csv(os.path.join(fx, "shopgoodwill", "shopgoodwill_2026-10-02.csv"), sg_header, mb_rows)

write_csv(os.path.join(fx, "shopgoodwill", "shopgoodwill_2026-10-03.csv"), sg_header,
          [sg_row(300 + i, 3) for i in range(5)])

# ---------------------------------------------------------------------------
# Upright — monthly XLSX (spans channels) + daily (incl. dup with eBay 10-02)
# ---------------------------------------------------------------------------
up_header = ["Channel", "Channel Item ID", "Channel Order ID", "Upright Product ID",
             "Quantity", "Title", "Category", "Store", "Lister", "Price", "Shipping",
             "Fees", "Ordered At", "Paid At"]

def up_row(i, day, channel=None, channel_order_id=None):
    channel = channel or rng.choice(["ShopGoodwill", "eBay"])
    price = rng.randint(500, 6000)
    ship = rng.randint(0, 700)
    fee = -round(price * 0.12)
    coid = channel_order_id or (f"SG-{88100+i}" if channel == "ShopGoodwill" else f"03-{8800000+i}")
    month = 9 if day <= 30 else 10
    return [channel, f"UPL-{55100+i}", coid, f"UPL-{55100+i}", 1,
            f"{rng.choice(CATEGORIES)} item #{i}", rng.choice(CATEGORIES),
            "South Bend eCom", rng.choice(["lister_a", "lister_b", "lister_c"]),
            money(price), money(ship), money(fee),
            f"2026-{month:02d}-{day:02d}T10:00:00Z",
            f"2026-{month:02d}-{day:02d}T18:00:00Z"]

up_rows = [up_row(i, 1 + (i % 28)) for i in range(22)]
write_xlsx(os.path.join(fx, "upright", "upright_2026-09.xlsx"), up_header, up_rows)

write_xlsx(os.path.join(fx, "upright", "upright_2026-10-01.xlsx"), up_header,
           [up_row(100 + i, 1) for i in range(4)])

# 10-02: duplicate of the eBay dup_order_no, same channel+order id -> dedupe test
dup_up_row = up_row(205, 2, channel="eBay", channel_order_id=dup_order_no)
up_d2 = [up_row(200 + i, 2) for i in range(4)] + [dup_up_row]
write_xlsx(os.path.join(fx, "upright", "upright_2026-10-02.xlsx"), up_header, up_d2)

write_xlsx(os.path.join(fx, "upright", "upright_2026-10-03.xlsx"), up_header,
           [up_row(300 + i, 3) for i in range(4)])

# ---------------------------------------------------------------------------
# Cash Monkey — monthly XLSX, B2B bulk orders, no buyer
# ---------------------------------------------------------------------------
cm_header = ["Order ID", "Order Date", "Item Count", "Gross", "Fees", "Net", "Status"]
cm_rows = []
for i in range(14):
    gross = rng.randint(5000, 40000)
    fee = -round(gross * 0.08)
    net = gross + fee
    cm_rows.append([f"CM-{7000+i}", f"2026-09-{1+(i%28):02d}", rng.randint(10, 120),
                    money(gross), money(fee), money(net), "Paid"])
write_xlsx(os.path.join(fx, "cashmonkey", "cashmonkey_2026-09.xlsx"), cm_header, cm_rows)

# ---------------------------------------------------------------------------
# Jewelry — monthly CSV, Supplier field, request-based
# ---------------------------------------------------------------------------
jw_header = ["Item ID", "Description", "Category", "Supplier", "Sale Price", "Fee",
             "Net", "Sale Date"]
jw_rows = []
for i in range(10):
    price = rng.randint(1500, 25000)
    fee = -round(price * 0.10)
    net = price + fee
    jw_rows.append([f"JW-{400+i}", f"Estate piece #{i}", "Jewelry",
                    rng.choice(["Direct Donation", "Consignment Partner A", "Unknown"]),
                    money(price), money(fee), money(net), f"2026-09-{1+(i%28):02d}"])
write_csv(os.path.join(fx, "jewelry", "jewelry_2026-09.csv"), jw_header, jw_rows)

# ---------------------------------------------------------------------------
# Shipping: OSM / Pitney Bowes / EasyPost — 3 separate monthly CSVs, one folder
# ---------------------------------------------------------------------------
ep_header = ["created_at", "id", "tracking_code", "status", "carrier", "service",
             "rate", "refund_status", "batch_id"]
ep_rows = []
for i in range(16):
    carrier = rng.choice(["USPS", "OSM"])
    rate = rng.randint(380, 1100)
    refund = rng.choice(["", "", "", "submitted", "refunded"])
    ep_rows.append([f"2026-09-{1+(i%28):02d}T{8+(i%9):02d}:00:00Z", f"shp_{9000+i}",
                    f"EZ{1009900+i}", "delivered", carrier,
                    rng.choice(["Ground", "Priority"]), money(-rate), refund,
                    f"batch_{200+i%5}"])
write_csv(os.path.join(fx, "shipping_osm_pb_easypost", "easypost_2026-09.csv"),
          ep_header, ep_rows)

pb_header = ["Shipment Create Date", "Sender Name", "Carrier Name", "Service",
             "Tracking Number", "Total Charges"]
pb_rows = []
for i in range(8):
    pb_rows.append([f"2026-09-{1+(i%28):02d}", "Goodwill Industries of Michiana",
                    "USPS", "Priority Mail", f"PB{7700000+i}", money(-rng.randint(420, 900))])
write_csv(os.path.join(fx, "shipping_osm_pb_easypost", "pitneybowes_2026-09.csv"),
          pb_header, pb_rows)

osm_header = ["Invoice #", "Ship Date", "Tracking", "Service", "Weight", "Charge"]
osm_rows = []
for i in range(8):
    osm_rows.append([f"OSM-{55000+i}", f"2026-09-{1+(i%28):02d}", f"OSM{330000+i}",
                     "Parcel Select", f"{rng.uniform(0.8, 6.5):.1f} lb",
                     money(-rng.randint(300, 650))])
write_csv(os.path.join(fx, "shipping_osm_pb_easypost", "osm_2026-09.csv"),
          osm_header, osm_rows)

# bank statement line (1st Source acct 0101) — the possible real source of truth
bank_header = ["Post Date", "Description", "Account", "Amount"]
bank_rows = [
    ["2026-09-05", "POSTAGE TOPUP - EASYPOST", "1ST SOURCE 0101", money(-150000)],
    ["2026-09-19", "POSTAGE TOPUP - EASYPOST", "1ST SOURCE 0101", money(-98000)],
]
write_csv(os.path.join(fx, "shipping_osm_pb_easypost", "bank_1st_source_0101_2026-09.csv"),
          bank_header, bank_rows)

# ---------------------------------------------------------------------------
# FedEx — monthly CSV with a refund line
# ---------------------------------------------------------------------------
fx_header = ["Invoice Number", "Invoice Date", "Tracking ID", "Shipment Date",
             "Service Type", "Net Charge Amount"]
fx_rows = []
for i in range(18):
    charge = rng.randint(700, 2200)
    fx_rows.append([f"88{12300+i}", f"2026-09-{1+(i%28):02d}", f"7812{3340000+i}",
                    f"2026-09-{1+(i%28):02d}", rng.choice(["Ground", "Home Delivery"]),
                    money(-charge)])
# refund line reversing row 4
fx_rows.insert(5, [fx_rows[4][0], "2026-09-11", fx_rows[4][2], fx_rows[4][3],
                   "Refund - " + fx_rows[4][4], money(-int(float(fx_rows[4][5]) * 100))])
write_csv(os.path.join(fx, "fedex", "fedex_2026-09.csv"), fx_header, fx_rows)

# ---------------------------------------------------------------------------
# Goodwill Books — monthly "statement" (header block + line items + total)
# ---------------------------------------------------------------------------
gb_path = os.path.join(fx, "goodwill_books", "goodwill_books_2026-09.csv")
os.makedirs(os.path.dirname(gb_path), exist_ok=True)
with open(gb_path, "w", newline="", encoding="utf-8") as f:
    f.write("GoodwillBooks.com — Seller Payment Statement\n")
    f.write("Seller: Goodwill Industries of Michiana\n")
    f.write("Period: September 2026\n")
    f.write("Payment Date: 2026-10-05\n")
    f.write("\n")
    w = csv.writer(f)
    w.writerow(["Order #", "SKU/ISBN", "Title", "Sale Price", "Commission/Fee", "Net"])
    total = 0
    for i in range(12):
        price = rng.randint(300, 1800)
        fee = -round(price * 0.32)
        net = price + fee
        total += net
        w.writerow([f"GB-{55100+i}", f"97{80000000000+i}", f"Book lot #{i}",
                    money(price), money(fee), money(net)])
    f.write("\n")
    f.write(f"Payment Total,,,,,{money(total)}\n")

print("Fixtures written under", fx)
