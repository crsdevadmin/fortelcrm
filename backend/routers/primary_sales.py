from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload

from ..auth.auth import get_current_user
from ..database import get_db
from ..models.models import PrimarySalesEntry, PrimarySalesUpload, Stockist, User
from ..services.primary_sales_import import (
    ensure_seed_stockists,
    infer_stockist_location,
    normalize_stockist_name,
    parse_primary_sales_workbook,
)


router = APIRouter(prefix="/primary-sales", tags=["Primary Sales"])
transport_router = APIRouter(prefix="/sales/primary", tags=["Primary Sales"])

UPLOAD_ROLES = {"admin", "md", "back_office"}
MAX_UPLOAD_BYTES = 15 * 1024 * 1024


class StockistUpdateRequest(BaseModel):
    region: str
    territory: str


def _require_uploader(user: User):
    if user.role not in UPLOAD_ROLES:
        raise HTTPException(status_code=403, detail="Only back-office, admin, or MD users can upload primary sales")


def _upload_payload(upload: PrimarySalesUpload):
    return {
        "id": upload.id,
        "filename": upload.filename,
        "period_start": upload.period_start,
        "period_end": upload.period_end,
        "source_row_count": upload.source_row_count,
        "inserted_count": upload.inserted_count,
        "updated_count": upload.updated_count,
        "skipped_count": upload.skipped_count,
        "total_net_amount": round(upload.total_net_amount or 0, 2),
        "uploaded_at": upload.uploaded_at,
        "uploaded_by_id": upload.uploaded_by_id,
        "uploaded_by_name": upload.uploaded_by.name if upload.uploaded_by else "",
    }


@router.get("/stockists")
@transport_router.get("/stockists")
def list_stockists(db: Session = Depends(get_db)):
    ensure_seed_stockists(db)
    db.commit()
    rows = db.query(Stockist).filter(Stockist.is_active == True).order_by(Stockist.region, Stockist.territory, Stockist.name).all()
    return [{
        "id": row.id,
        "name": row.name,
        "region": row.region,
        "territory": row.territory,
        "is_unassigned": row.region == "Unassigned" or row.territory == "Unassigned",
    } for row in rows]


@router.patch("/stockists/{stockist_id}")
@transport_router.patch("/stockists/{stockist_id}")
def update_stockist(
    stockist_id: int,
    payload: StockistUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_uploader(current_user)
    stockist = db.query(Stockist).filter(Stockist.id == stockist_id).first()
    if not stockist:
        raise HTTPException(status_code=404, detail="Stockist not found")
    region = " ".join(payload.region.strip().split())
    territory = " ".join(payload.territory.strip().split())
    if not region or not territory:
        raise HTTPException(status_code=400, detail="Region and territory are required")
    stockist.region = region
    stockist.territory = territory
    stockist.updated_at = datetime.utcnow()
    db.commit()
    return {"id": stockist.id, "name": stockist.name, "region": stockist.region, "territory": stockist.territory}


@router.post("/upload")
@transport_router.post("/upload")
async def upload_primary_sales(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_uploader(current_user)
    filename = (file.filename or "primary-sales.xls")[:255]
    content = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Excel file must be 15 MB or smaller")
    if not content:
        raise HTTPException(status_code=400, detail="The uploaded Excel file is empty")
    try:
        parsed = parse_primary_sales_workbook(content, filename)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    duplicate = db.query(PrimarySalesUpload).options(joinedload(PrimarySalesUpload.uploaded_by)).filter(
        PrimarySalesUpload.file_checksum == parsed["file_checksum"]
    ).first()
    if duplicate:
        return {"status": "duplicate", "message": "This exact Excel file was already uploaded", "upload": _upload_payload(duplicate)}

    rows = parsed["rows"]
    dates = sorted(row["bill_date"] for row in rows if row["bill_date"])
    upload = PrimarySalesUpload(
        uploaded_by_id=current_user.id,
        filename=filename,
        file_checksum=parsed["file_checksum"],
        period_start=dates[0] if dates else None,
        period_end=dates[-1] if dates else None,
        source_row_count=len(rows),
        skipped_count=parsed["skipped_count"],
        total_net_amount=round(sum(row["net_amount"] for row in rows), 2),
    )
    db.add(upload)
    db.flush()

    stockists = ensure_seed_stockists(db)
    for row in rows:
        normalized = row["normalized_stockist_name"]
        if normalized in stockists:
            continue
        region, territory = infer_stockist_location(row.get("gst_number"), row["stockist_name"])
        stockist = Stockist(
            name=row["stockist_name"],
            normalized_name=normalized,
            region=region,
            territory=territory,
        )
        db.add(stockist)
        db.flush()
        stockists[normalized] = stockist

    source_keys = [row["source_key"] for row in rows]
    existing_entries = {
        entry.source_key: entry
        for entry in db.query(PrimarySalesEntry).filter(PrimarySalesEntry.source_key.in_(source_keys)).all()
    }
    inserted = 0
    updated = 0
    for row in rows:
        values = {
            "upload_id": upload.id,
            "uploaded_by_id": current_user.id,
            "stockist_id": stockists[row["normalized_stockist_name"]].id,
            "bill_number": row["bill_number"],
            "bill_date": row["bill_date"],
            "product_name": row["product_name"],
            "batch_number": row["batch_number"] or None,
            "quantity": row["quantity"],
            "free_quantity": row["free_quantity"],
            "rate": row["rate"],
            "gross_amount": row["gross_amount"],
            "net_amount": row["net_amount"],
            "tax_amount": row["tax_amount"],
            "gst_number": row["gst_number"] or None,
            "updated_at": datetime.utcnow(),
        }
        entry = existing_entries.get(row["source_key"])
        if entry:
            for field, value in values.items():
                setattr(entry, field, value)
            updated += 1
        else:
            db.add(PrimarySalesEntry(source_key=row["source_key"], **values))
            inserted += 1

    upload.inserted_count = inserted
    upload.updated_count = updated
    db.commit()
    db.refresh(upload)
    unassigned = sorted({
        stockists[row["normalized_stockist_name"]].name
        for row in rows
        if stockists[row["normalized_stockist_name"]].territory == "Unassigned"
    })
    return {
        "status": "uploaded",
        "message": f"Imported {inserted} new rows and refreshed {updated} existing rows",
        "upload": _upload_payload(upload),
        "unassigned_stockists": unassigned,
    }


@router.get("/summary")
@transport_router.get("/summary")
def primary_sales_summary(
    year: Optional[int] = None,
    month: Optional[int] = None,
    region: Optional[str] = None,
    territory: Optional[str] = None,
    stockist_id: Optional[int] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: Session = Depends(get_db),
):
    ensure_seed_stockists(db)
    db.commit()
    if year is None:
        year = datetime.utcnow().year
    if month is None:
        month = datetime.utcnow().month
    if month < 1 or month > 12:
        raise HTTPException(status_code=400, detail="Invalid month")

    query = db.query(PrimarySalesEntry).options(joinedload(PrimarySalesEntry.stockist))
    if start_date or end_date:
        if start_date:
            query = query.filter(PrimarySalesEntry.bill_date >= start_date)
        if end_date:
            query = query.filter(PrimarySalesEntry.bill_date <= end_date)
    else:
        query = query.filter(PrimarySalesEntry.bill_date.like(f"{year:04d}-{month:02d}-%"))
    if stockist_id:
        query = query.filter(PrimarySalesEntry.stockist_id == stockist_id)
    if region and region != "ALL":
        query = query.join(Stockist).filter(Stockist.region == region)
    if territory and territory != "ALL":
        if not region or region == "ALL":
            query = query.join(Stockist)
        query = query.filter(Stockist.territory == territory)
    entries = query.order_by(PrimarySalesEntry.bill_date.desc(), PrimarySalesEntry.id.desc()).all()

    stockist_rows = {}
    product_rows = {}
    region_totals = {}
    territory_totals = {}
    bills = set()
    total_quantity = 0.0
    total_net = 0.0
    for entry in entries:
        stockist = entry.stockist
        region_name = stockist.region if stockist else "Unassigned"
        territory_name = stockist.territory if stockist else "Unassigned"
        total_quantity += entry.quantity or 0
        total_net += entry.net_amount or 0
        bill_key = (entry.stockist_id, entry.bill_number)
        bills.add(bill_key)
        region_totals[region_name] = region_totals.get(region_name, 0) + (entry.net_amount or 0)
        territory_key = (region_name, territory_name)
        territory_totals[territory_key] = territory_totals.get(territory_key, 0) + (entry.net_amount or 0)

        stockist_row = stockist_rows.setdefault(entry.stockist_id, {
            "stockist_id": entry.stockist_id,
            "stockist_name": stockist.name if stockist else "Unknown",
            "region": region_name,
            "territory": territory_name,
            "net_amount": 0.0,
            "quantity": 0.0,
            "line_count": 0,
            "bills": set(),
        })
        stockist_row["net_amount"] += entry.net_amount or 0
        stockist_row["quantity"] += entry.quantity or 0
        stockist_row["line_count"] += 1
        stockist_row["bills"].add(entry.bill_number)

        product_key = entry.product_name.strip().upper()
        product_row = product_rows.setdefault(product_key, {
            "product_name": entry.product_name,
            "net_amount": 0.0,
            "quantity": 0.0,
            "line_count": 0,
        })
        product_row["net_amount"] += entry.net_amount or 0
        product_row["quantity"] += entry.quantity or 0
        product_row["line_count"] += 1

    by_stockist = []
    for item in stockist_rows.values():
        by_stockist.append({
            **{key: value for key, value in item.items() if key != "bills"},
            "bill_count": len(item["bills"]),
            "net_amount": round(item["net_amount"], 2),
            "quantity": round(item["quantity"], 2),
        })
    by_stockist.sort(key=lambda item: (-item["net_amount"], item["stockist_name"]))
    by_product = [{
        **item,
        "net_amount": round(item["net_amount"], 2),
        "quantity": round(item["quantity"], 2),
    } for item in product_rows.values()]
    by_product.sort(key=lambda item: (-item["net_amount"], item["product_name"]))

    stockists = db.query(Stockist).filter(Stockist.is_active == True).order_by(Stockist.name).all()
    recent_uploads = db.query(PrimarySalesUpload).options(joinedload(PrimarySalesUpload.uploaded_by)).order_by(
        PrimarySalesUpload.uploaded_at.desc()
    ).limit(10).all()
    return {
        "period": {"year": year, "month": month, "start_date": start_date, "end_date": end_date},
        "filters": {"region": region or "ALL", "territory": territory or "ALL", "stockist_id": stockist_id},
        "total_net_amount": round(total_net, 2),
        "total_quantity": round(total_quantity, 2),
        "bill_count": len(bills),
        "line_count": len(entries),
        "stockist_count": len(stockist_rows),
        "by_region": [
            {"region": name, "net_amount": round(amount, 2)}
            for name, amount in sorted(region_totals.items(), key=lambda item: -item[1])
        ],
        "by_territory": [
            {"region": key[0], "territory": key[1], "net_amount": round(amount, 2)}
            for key, amount in sorted(territory_totals.items(), key=lambda item: -item[1])
        ],
        "by_stockist": by_stockist,
        "by_product": by_product,
        "options": {
            "regions": sorted({row.region for row in stockists}),
            "territories": sorted({row.territory for row in stockists}),
            "stockists": [{"id": row.id, "name": row.name, "region": row.region, "territory": row.territory} for row in stockists],
        },
        "unassigned_stockists": [
            {"id": row.id, "name": row.name, "region": row.region, "territory": row.territory}
            for row in stockists
            if row.region == "Unassigned" or row.territory == "Unassigned"
        ],
        "recent_uploads": [_upload_payload(upload) for upload in recent_uploads],
    }
