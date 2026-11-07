"""The published plan catalog rendered by the Pricing & Plans page.

Kept server-side so plan copy, quotas, and the comparison matrix have one source of truth, and so
the page can mark the signed-in user's current tier.
"""

from sqlalchemy.orm import Session

from app.models.user import User
from app.schemas.plans import (
    ComparisonCell,
    ComparisonGroup,
    ComparisonRow,
    PlanFaq,
    PlanFeature,
    PricingCatalogResponse,
    PricingPlan,
    SecurityBadge,
    TrustPanel,
)
from app.services.auth import get_user_subscription

ANNUAL_DISCOUNT_PERCENT = 20

_PLANS: list[PricingPlan] = [
    PricingPlan(
        id="starter",
        tier="free",
        name="Free Starter",
        icon="drafts",
        tagline="A small monthly allowance for trying FrameNote without a card.",
        price_monthly=0,
        price_annual_monthly=0,
        price_annual_total=0,
        features_heading="INCLUDED IN STARTER:",
        features=[
            PlanFeature(emphasis="1 uploaded video", text="/ month (up to 15 minutes)"),
            PlanFeature(emphasis="3 YouTube caption notes", text="/ month"),
            PlanFeature(text="Standard AI summary and key moments"),
            PlanFeature(text="Ask this video: 3 questions per video, 10 per month"),
            PlanFeature(text="PDF export"),
            PlanFeature(text="7-day cloud history retention"),
            PlanFeature(text="Self-service support"),
        ],
        cta_label="Current Plan",
        cta_action="current",
    ),
    PricingPlan(
        id="solo_pro",
        tier="pro",
        name="Solo Pro",
        icon="psychology",
        tagline="For regular use with longer recordings and detailed analysis.",
        price_monthly=15,
        price_annual_monthly=12,
        price_annual_total=144,
        features_heading="EVERYTHING IN STARTER PLUS:",
        features=[
            PlanFeature(emphasis="5 hours", text="of uploaded video / month"),
            PlanFeature(text="Up to 90 minutes per uploaded video"),
            PlanFeature(text="Detailed timeline, decisions, Q&A and action items"),
            PlanFeature(text="Ask this video: 100 questions per month"),
            PlanFeature(text="Speaker airtime from supported transcript files"),
            PlanFeature(text="Detailed and summary PDF exports"),
            PlanFeature(text="90-day cloud history retention"),
        ],
        cta_label="Upgrade to Solo Pro",
        cta_action="checkout",
        most_popular=True,
    ),
]

COMPARISON_COLUMNS = ["Starter", "Solo Pro"]


def _text(value: str, highlight: bool = False) -> ComparisonCell:
    return ComparisonCell(kind="text", value=value, highlight=highlight)


def _check() -> ComparisonCell:
    return ComparisonCell(kind="check")


def _none() -> ComparisonCell:
    return ComparisonCell(kind="none")


_COMPARISON: list[ComparisonGroup] = [
    ComparisonGroup(
        title="1. TRANSCRIPTION & INGESTION",
        rows=[
            ComparisonRow(
                label="Monthly transcription allocation",
                cells=[
                    _text("1 upload / mo"),
                    _text("5 hours / mo", highlight=True),
                ],
            ),
            ComparisonRow(
                label="Max individual file length",
                cells=[_text("15 mins"), _text("90 mins")],
            ),
            ComparisonRow(
                label="YouTube videos with captions",
                cells=[_text("3 / mo"), _check()],
            ),
            ComparisonRow(
                label="Public video links",
                cells=[_check(), _check()],
            ),
        ],
    ),
    ComparisonGroup(
        title="2. AI SYNTHESIS & MODELS",
        rows=[
            ComparisonRow(
                label="Standard summary and key moments",
                cells=[_check(), _check()],
            ),
            ComparisonRow(
                label="Detailed timeline, decisions, Q&A and actions",
                cells=[_none(), _check()],
            ),
            ComparisonRow(
                label="Ask this video",
                cells=[_text("3 / video, 10 / mo"), _text("100 / mo", highlight=True)],
            ),
            ComparisonRow(
                label="PDF export",
                cells=[_check(), _check()],
            ),
            ComparisonRow(
                label="Speaker airtime from an uploaded transcript",
                cells=[_none(), _check()],
            ),
        ],
    ),
    ComparisonGroup(
        title="3. STORAGE & SUPPORT",
        rows=[
            ComparisonRow(
                label="Retention period",
                cells=[_text("7 days"), _text("90 days", highlight=True)],
            ),
            ComparisonRow(
                label="Support",
                cells=[_text("Self-service"), _text("Email support", highlight=True)],
            ),
        ],
    ),
]

_TRUST = TrustPanel(
    eyebrow="EARLY ACCESS",
    headline="Clear limits, simple pricing, and no invented promises.",
    detail="FrameNote is in beta. We keep plan limits visible while we improve reliability and control processing costs.",
    badges=[
        SecurityBadge(icon="lock", title="Private library", subtitle="Account scoped"),
        SecurityBadge(icon="delete", title="Delete account", subtitle="Self-service"),
        SecurityBadge(icon="speed", title="Usage limits", subtitle="Budget aware"),
        SecurityBadge(icon="https", title="Secure transport", subtitle="HTTPS at launch"),
    ],
    social_proof="Built for a small early-access group before a wider launch.",
    rating="No long-term contract",
    speed="Cancel anytime",
)

_FAQS = [
    PlanFaq(
        question="Can I switch or cancel my plan at any time?",
        answer=(
            "Yes, absolutely. You can upgrade, downgrade, or cancel your subscription directly from your "
            "billing workspace at any point. When downgrading, your existing plan benefits remain active "
            "until the end of your current billing cycle."
        ),
    ),
    PlanFaq(
        question="How are monthly transcription hours calculated?",
        answer=(
            "Hours are counted by the actual runtime of the ingested video or audio file, rounded to the "
            "nearest minute. For example, synthesizing a 42-minute meeting utilizes exactly 42 minutes from "
            "your plan pool. Failed uploads or corrupted audio are automatically credited back."
        ),
    ),
    PlanFaq(
        question="What happens if I hit my monthly transcription limit?",
        answer=(
            "FrameNote shows your usage in the dashboard. Free users can wait for the next monthly reset or "
            "upgrade to Solo Pro. Pro users can contact support if they need a larger allowance."
        ),
    ),
    PlanFaq(
        question="Do you train AI models on my private video recordings or transcripts?",
        answer=(
            "FrameNote sends only the content needed for transcription and analysis to the configured AI "
            "provider. The final provider and retention policy will be published before public launch."
        ),
    ),
    PlanFaq(
        question="Why are the beta limits small?",
        answer=(
            "Video transcription has a real processing cost. The beta limits keep FrameNote affordable and "
            "reliable while we measure usage and improve the service."
        ),
    ),
]

_TIER_RANK = {"free": 0, "pro": 1}


def build_pricing_catalog(db: Session, user: User) -> PricingCatalogResponse:
    subscription = get_user_subscription(db=db, user_id=user.id)
    current_tier = subscription.tier if subscription.tier in _TIER_RANK else "free"
    current_rank = _TIER_RANK[current_tier]

    plans: list[PricingPlan] = []
    for plan in _PLANS:
        resolved = plan.model_copy()
        resolved.is_current = plan.tier == current_tier
        if resolved.is_current:
            resolved.cta_label = "Current Plan"
            resolved.cta_action = "current"
        elif plan.cta_action != "contact":
            rank = _TIER_RANK[plan.tier]
            if rank < current_rank:
                resolved.cta_label = f"Switch to {plan.name}"
                resolved.cta_action = "downgrade"
            else:
                resolved.cta_action = "checkout"
        plans.append(resolved)

    return PricingCatalogResponse(
        current_tier=current_tier,
        annual_discount_percent=ANNUAL_DISCOUNT_PERCENT,
        plans=plans,
        comparison_columns=COMPARISON_COLUMNS,
        comparison=_COMPARISON,
        trust=_TRUST,
        faqs=_FAQS,
    )
