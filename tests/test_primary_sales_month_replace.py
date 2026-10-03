import unittest
from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.database import Base
from backend.models.models import PrimarySalesEntry, PrimarySalesUpload, PrimaryCitySplitEntry, PrimaryCitySplitUpload, User
from backend.routers import primary_sales as ps


def _rows(month, n=2, prefix="F"):
    return [{
        "stockist_name": "CBE HEXACARE", "normalized_stockist_name": "CBE HEXACARE",
        "bill_number": f"{prefix}{month}{i}", "bill_date": f"2026-{month}-0{i + 1}",
        "product_name": "REFILAC CAP", "batch_number": "", "quantity": 1, "free_quantity": 0,
        "rate": 100, "gross_amount": 100, "net_amount": 105, "tax_amount": 5, "gst_number": "",
        "city": "COIMBATORE", "source_key": f"{prefix}-{month}-{i}",
    } for i in range(n)]


class MonthReplaceTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite://")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        user = User(name="Staff", email="staff1@fortel.in", role="back_office", password_hash="x")
        self.db.add(user)
        self.db.commit()
        self.user = user

    def _upload_fortel(self, month, n=2):
        ps.parse_primary_sales_workbook = lambda c, f: {"rows": _rows(month, n), "skipped_count": 0, "file_checksum": f"f{month}{n}".ljust(64, "0")}
        return ps._persist_primary_sales(b"x", f"{month}.xls", self.user, self.db)

    def _upload_nexus(self, month, n=2):
        ps.parse_primary_city_split_workbook = lambda c, f: {"rows": _rows(month, n, "N"), "skipped_count": 0, "file_checksum": f"n{month}{n}".ljust(64, "0")}
        return ps._persist_primary_city_split(b"x", f"{month}.xls", self.user, self.db)

    def test_fortel_months_are_preserved(self):
        for month in ("06", "07", "08"):
            self._upload_fortel(month)
        self.assertEqual(6, self.db.query(PrimarySalesEntry).count())
        self.assertEqual(3, self.db.query(PrimarySalesUpload).count())
        result = self._upload_fortel("07", 3)  # re-upload July only
        self.assertEqual(2, result["replaced_rows"])
        self.assertEqual(7, self.db.query(PrimarySalesEntry).count())
        self.assertEqual(3, self.db.query(PrimarySalesUpload).count())

    def test_nexus_months_are_preserved(self):
        for month in ("06", "07", "08"):
            self._upload_nexus(month)
        self.assertEqual(6, self.db.query(PrimaryCitySplitEntry).count())
        self.assertEqual(3, self.db.query(PrimaryCitySplitUpload).count())


if __name__ == "__main__":
    unittest.main()
