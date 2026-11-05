from typing import Literal

from pydantic import BaseModel, Field

PlanCtaAction = Literal["current", "checkout", "contact", "downgrade"]


class PlanFeature(BaseModel):
    # `emphasis` renders as the bolded lead-in, e.g. "5 hours" + " of uploaded video / month".
    emphasis: str | None = None
    text: str


class PricingPlan(BaseModel):
    id: str
    tier: str
    name: str
    icon: str
    tagline: str
    price_monthly: int | None = None
    # Effective per-month price when billed annually, plus the annual total for the fine print.
    price_annual_monthly: int | None = None
    price_annual_total: int | None = None
    custom_price_label: str | None = None
    price_note: str | None = None
    features_heading: str
    features: list[PlanFeature] = Field(default_factory=list)
    cta_label: str
    cta_action: PlanCtaAction
    most_popular: bool = False
    is_current: bool = False


class ComparisonCell(BaseModel):
    # "text" renders a label, "check" a tick, "none" an em dash.
    kind: Literal["text", "check", "none"] = "text"
    value: str | None = None
    highlight: bool = False


class ComparisonRow(BaseModel):
    label: str
    cells: list[ComparisonCell]


class ComparisonGroup(BaseModel):
    title: str
    rows: list[ComparisonRow]


class SecurityBadge(BaseModel):
    icon: str
    title: str
    subtitle: str


class TrustPanel(BaseModel):
    eyebrow: str
    headline: str
    detail: str
    badges: list[SecurityBadge] = Field(default_factory=list)
    social_proof: str
    rating: str
    speed: str


class PlanFaq(BaseModel):
    question: str
    answer: str


class PricingCatalogResponse(BaseModel):
    current_tier: str
    annual_discount_percent: int = 20
    plans: list[PricingPlan]
    comparison_columns: list[str]
    comparison: list[ComparisonGroup]
    trust: TrustPanel
    faqs: list[PlanFaq]


class CheckoutSessionRequest(BaseModel):
    plan: str = "pro"
    billing_cycle: Literal["monthly", "annual"] = "monthly"
