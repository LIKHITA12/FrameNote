import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db import Base
from app.models.user import User
from app.services.plans import build_pricing_catalog


class RegionalPricingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.db = sessionmaker(bind=self.engine)()
        self.user = User(email="viewer@example.test")
        self.db.add(self.user)
        self.db.commit()

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def _pro(self, catalog):
        return next(plan for plan in catalog.plans if plan.tier == "pro")

    def test_default_catalog_is_usd(self) -> None:
        catalog = build_pricing_catalog(db=self.db, user=self.user)
        self.assertEqual((catalog.currency, catalog.currency_symbol, catalog.region), ("USD", "$", "GLOBAL"))
        pro = self._pro(catalog)
        self.assertEqual((pro.price_monthly, pro.price_annual_monthly, pro.price_annual_total), (12, 8, 96))
        self.assertEqual(catalog.annual_discount_percent, 33)

    def test_india_sees_inr_prices_matching_dodo_products(self) -> None:
        catalog = build_pricing_catalog(db=self.db, user=self.user, region="in")
        self.assertEqual((catalog.currency, catalog.currency_symbol, catalog.region), ("INR", "₹", "IN"))
        pro = self._pro(catalog)
        self.assertEqual((pro.price_monthly, pro.price_annual_monthly, pro.price_annual_total), (399, 333, 3999))
        self.assertEqual(catalog.annual_discount_percent, 16)
        free = next(plan for plan in catalog.plans if plan.tier == "free")
        self.assertEqual(free.price_monthly, 0)

    def test_unknown_region_falls_back_to_usd(self) -> None:
        catalog = build_pricing_catalog(db=self.db, user=self.user, region="ZZ")
        self.assertEqual(catalog.currency, "USD")
        self.assertEqual(self._pro(catalog).price_monthly, 12)

    def test_india_prices_do_not_leak_into_the_shared_plan_list(self) -> None:
        build_pricing_catalog(db=self.db, user=self.user, region="IN")
        self.assertEqual(self._pro(build_pricing_catalog(db=self.db, user=self.user)).price_monthly, 12)


if __name__ == "__main__":
    unittest.main()
