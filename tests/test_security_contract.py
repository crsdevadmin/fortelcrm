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
