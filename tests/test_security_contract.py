import ast
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class SecurityContractTests(unittest.TestCase):
    def test_every_private_router_has_central_security_dependency(self):
        for relative in ("backend/main.py", "backend/main_updated.py", "run.py"):
            tree = ast.parse((ROOT / relative).read_text())
            for node in ast.walk(tree):
                if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute):
                    continue
                if node.func.attr != "include_router" or not node.args:
                    continue
                router = ast.unparse(node.args[0])
                if router == "auth_router":
                    continue
                keywords = {item.arg for item in node.keywords}
                self.assertIn("dependencies", keywords, f"{relative}: {router} is not centrally protected")

    def test_sensitive_auth_routes_require_a_dependency(self):
        tree = ast.parse((ROOT / "backend/auth/auth.py").read_text())
        protected = {"change_password", "admin_reset_password", "get_me"}
        found = set()
        for node in tree.body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in protected:
                found.add(node.name)
                defaults = list(node.args.defaults) + list(node.args.kw_defaults)
                self.assertTrue(
                    any(isinstance(value, ast.Call) and ast.unparse(value.func) == "Depends" for value in defaults if value),
                    f"{node.name} lost its authentication dependency",
                )
        self.assertEqual(protected, found)

    def test_request_identity_guard_covers_spoofable_actor_fields(self):
        source = (ROOT / "backend/auth/auth.py").read_text()
        for field in (
            "viewer_id", "actor_id", "associate_id", "approver_id",
            "approved_by_id", "assigned_by_id", "created_by_id", "user_id",
        ):
            self.assertIn(f'"{field}"', source)

    def test_back_office_role_is_restricted_to_primary_sales_api(self):
        source = (ROOT / "backend/auth/auth.py").read_text()
        self.assertIn('current_user.role == "back_office"', source)
        self.assertIn('request.url.path.startswith("/primary-sales")', source)
        self.assertIn('request.url.path.startswith("/sales/primary")', source)

    def test_primary_sales_upload_is_limited_to_staff_accounts(self):
        source = (ROOT / "backend/routers/primary_sales.py").read_text()
        self.assertIn('"staff1@fortel.in"', source)
        self.assertIn('"staff2@fortel.in"', source)
        self.assertIn('user.role != "back_office"', source)
        self.assertNotIn('UPLOAD_ROLES = {"admin", "md", "back_office"}', source)

    def test_primary_sales_upload_delete_requires_staff_and_typed_confirmation(self):
        source = (ROOT / "backend/routers/primary_sales.py").read_text()
        self.assertIn('@transport_router.delete("/uploads/{upload_id}")', source)
        self.assertIn('payload.confirmation.strip().upper() != "DELETE UPLOAD"', source)
        delete_function = source[source.index("def delete_primary_sales_upload"):]
        self.assertIn("_require_uploader(current_user)", delete_function)

    def test_city_split_upload_and_delete_are_staff_only(self):
        source = (ROOT / "backend/routers/primary_sales.py").read_text()
        self.assertIn('@transport_router.post("/city-split/upload-session/start")', source)
        self.assertIn('@transport_router.delete("/city-split/uploads/{upload_id}")', source)
        upload_function = source[source.index("def start_city_split_upload_session"):]
        delete_function = source[source.index("def delete_primary_city_split_upload"):]
        self.assertIn("_require_uploader(current_user)", upload_function)
        self.assertIn("_require_uploader(current_user)", delete_function)

    def test_new_primary_workbooks_replace_their_previous_dataset(self):
        source = (ROOT / "backend/routers/primary_sales.py").read_text()
        primary_function = source[source.index("def _persist_primary_sales"):source.index("@router.get(\"/stockists\")")]
        city_function = source[source.index("def _persist_primary_city_split"):source.index("def _persist_primary_sales")]
        self.assertIn("db.query(PrimarySalesEntry).delete", primary_function)
        self.assertIn("db.query(PrimarySalesUpload).delete", primary_function)
        self.assertIn("db.query(PrimaryCitySplitEntry).delete", city_function)
        self.assertIn("db.query(PrimaryCitySplitUpload).delete", city_function)
        self.assertNotIn('status": "duplicate"', primary_function)
        self.assertNotIn('status": "duplicate"', city_function)

    def test_plaintext_password_runtime_references_are_removed(self):
        allowed = ROOT / "backend/scripts/security_migration.py"
        offenders = []
        for path in (ROOT / "backend").rglob("*.py"):
            if path == allowed:
                continue
            if "plain_password" in path.read_text():
                offenders.append(str(path.relative_to(ROOT)))
        self.assertEqual([], offenders)

    def test_known_committed_default_passwords_are_removed(self):
        offenders = []
        for path in list((ROOT / "backend").rglob("*.py")) + [ROOT / "reset_admin.py", ROOT / "test_login.py"]:
            text = path.read_text()
            if "Fortel@2025" in text or "admin2026" in text:
                offenders.append(str(path.relative_to(ROOT)))
        self.assertEqual([], offenders)

    def test_investment_delete_route_is_unique(self):
        tree = ast.parse((ROOT / "backend/routers/investments.py").read_text())
        registrations = 0
        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for decorator in node.decorator_list:
                if (
                    isinstance(decorator, ast.Call)
                    and isinstance(decorator.func, ast.Attribute)
                    and decorator.func.attr == "delete"
                    and decorator.args
                    and isinstance(decorator.args[0], ast.Constant)
                    and decorator.args[0].value == "/{investment_id}"
                ):
                    registrations += 1
        self.assertEqual(1, registrations)

    def test_hierarchy_walk_has_cycle_guard(self):
        source = (ROOT / "backend/utils/hierarchy.py").read_text()
        self.assertIn("if current in visible:", source)


if __name__ == "__main__":
    unittest.main()
