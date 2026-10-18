"""Legal document types: detection, and what to look for in each.

Generic output came from treating every document like the same contract: one
prompt, one fixed list of "not found" topics (governing law, dispute resolution
...) whatever the document was. Each type here carries:

- signals: phrases that suggest the type (weighted; title lines count more)
- focus: points the model is asked to look for, *if the excerpts contain them*
- topics: points documents of this type usually address; ones not identified in
  the text are reported as "not identified", never as "missing from the law"

Detection is deterministic and explainable. The user can override it.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Topic:
    name: str
    pattern: re.Pattern[str]


@dataclass(frozen=True)
class DocType:
    id: str
    label: str
    signals: tuple[tuple[str, float], ...]
    focus: str
    topics: tuple[Topic, ...] = field(default_factory=tuple)


def _t(name: str, pattern: str) -> Topic:
    return Topic(name, re.compile(pattern, re.I))


GOVERNING_LAW = _t("Governing law", r"governing law|governed by|laws of|jurisdiction")
DISPUTES = _t("Dispute resolution", r"arbitrat|dispute|\bcourts?\b|mediat")
TERMINATION = _t("Termination or ending the agreement", r"terminat|cancel|expir|end (?:this|the) (?:agreement|lease|contract|employment)")
PAYMENT = _t("Payment terms", r"\bpay|\bfees?\b|invoice|compensation|consideration|price|remuneration")
LIABILITY = _t("Liability or indemnity", r"liabilit|liable|indemn")
CONFIDENTIALITY = _t("Confidentiality", r"confidential|non-disclosure|proprietary information")

TYPES: tuple[DocType, ...] = (
    DocType(
        "rental", "Rental or lease agreement",
        ((r"\b(?:rental|lease|tenancy|leave and licen[cs]e) (?:agreement|deed|contract)\b", 6), (r"\blandlord\b|\blessor\b|\blicensor\b", 2),
         (r"\btenant\b|\blessee\b|\blicensee\b", 2), (r"\brent\b", 1.5), (r"security deposit", 2), (r"\bpremises\b|\bflat\b|\bapartment\b", 1)),
        "rent amount and due date, security deposit and how it is refunded, maintenance and repairs, lock-in period, "
        "notice and termination, renewal or rent increase, entry by the landlord, utilities, and restrictions on use",
        (_t("Rent amount and due date", r"\brent\b"), _t("Security deposit", r"deposit"), _t("Maintenance and repairs", r"repair|maintenan"),
         _t("Notice period", r"\bnotice\b"), TERMINATION, _t("Renewal or rent increase", r"renew|extension|increase|escalat"),
         _t("Penalties or late fees", r"penalt|late fee|late charge|\binterest\b|\bfines?\b"), _t("Lock-in period", r"lock-?in|minimum (?:period|term)"),
         _t("Subletting or use restrictions", r"sub-?let|sub-?lease|residential purpose|\bpets?\b|shall not use")),
    ),
    DocType(
        "employment", "Employment contract or offer letter",
        ((r"\bemployment (?:agreement|contract)\b|\boffer letter\b|\bletter of (?:appointment|offer)\b|\bappointment letter\b", 6),
         (r"\bemployee\b", 2), (r"\bemployer\b", 2), (r"\bsalary\b|\bctc\b|\bremuneration\b", 2), (r"\bprobation\b", 2),
         (r"\bdesignation\b|\bjob title\b|\bposition of\b", 1.5)),
        "salary and benefits, probation, working hours and leave, notice period and termination, confidentiality, "
        "ownership of work and intellectual property, non-compete or non-solicitation restrictions, and bonds or repayment obligations",
        (_t("Salary or compensation", r"salary|compensation|remuneration|\bctc\b|\bpay\b"), _t("Probation", r"probation"),
         _t("Notice period", r"\bnotice\b"), TERMINATION, CONFIDENTIALITY,
         _t("Intellectual property", r"intellectual property|\bip\b|invention|work product|copyright"),
         _t("Restrictions after leaving (non-compete, non-solicit)", r"non-compet|non-solicit|restrictive covenant|shall not .{0,40}(?:join|work for|solicit)"),
         _t("Leave and working hours", r"\bleave\b|working hours|holiday")),
    ),
    DocType(
        "legal_notice", "Legal notice or demand notice",
        ((r"\blegal notice\b|\bdemand notice\b|\bnotice under section\b|\bcease and desist\b", 7), (r"\bunder instructions? (?:from|of) my client\b|\bmy client\b", 3),
         (r"\byou are (?:hereby )?(?:called upon|required|directed)\b", 3), (r"\bfailing which\b", 2), (r"\bwithin (?:\w+ )?\(?\d+\)? days\b", 1),
         (r"\badvocate\b|\bsolicitor\b", 1.5)),
        "who is sending the notice and on whose behalf, who it is addressed to, what is alleged, what is demanded, "
        "the deadline to respond or comply, what the sender says will happen if the demand is not met, and any amounts claimed",
        (_t("Who the notice is from and to", r"\bmy client\b|\bto\b|\bfrom\b|addressed"), _t("What is alleged", r"alleg|breach|fail|default|due|owed"),
         _t("What is demanded", r"call(?:ed)? upon|demand|required to|direct(?:ed)? to|pay"), _t("Deadline to respond", r"within .{0,20}days|on or before|by \d"),
         _t("Stated consequences", r"failing which|legal (?:action|proceedings)|initiate|constrained to")),
    ),
    DocType(
        "nda", "Non-disclosure agreement (NDA)",
        ((r"\bnon[- ]disclosure agreement\b|\bconfidentiality agreement\b|\bNDA\b", 7), (r"\bconfidential information\b", 3),
         (r"\bdisclosing party\b|\breceiving party\b", 3), (r"\bpermitted (?:use|purpose|disclosure)\b", 1.5)),
        "what counts as confidential information, what is excluded, permitted use and disclosure, how long the duty lasts, "
        "return or destruction of information, remedies for breach, and whether obligations are one-way or mutual",
        (_t("Definition of confidential information", r"confidential information"), _t("Exclusions", r"exclu|does not include|shall not apply|public"),
         _t("Permitted disclosure", r"permitted|may disclose|required by law"), _t("Duration of the obligation", r"\byears?\b|period|surviv|perpetu"),
         _t("Return or destruction of information", r"return|destr"), _t("Remedies for breach", r"injunct|remed|damages|breach"), GOVERNING_LAW),
    ),
    DocType(
        "freelance", "Freelance or consulting agreement",
        ((r"\b(?:freelance|consulting|consultancy|independent contractor) (?:agreement|contract)\b", 7), (r"\bconsultant\b|\bfreelancer\b|\bindependent contractor\b", 3),
         (r"\bdeliverables?\b", 1), (r"\bhourly rate\b|\bper hour\b|\bretainer\b", 2)),
        "scope of work and deliverables, rates and invoicing, payment deadlines, who owns the work, confidentiality, "
        "independent-contractor status, expenses, termination and any kill fee, and liability limits",
        (_t("Scope of work", r"scope|services|deliverable"), PAYMENT, _t("Ownership of the work", r"intellectual property|ownership|owns|assign|work product|copyright"),
         CONFIDENTIALITY, TERMINATION, LIABILITY),
    ),
    DocType(
        "service", "Service agreement",
        ((r"\b(?:service|services|master services|maintenance|support|subscription) agreement\b", 6), (r"\bservice provider\b|\bprovider\b", 2),
         (r"\bscope of (?:work|services)\b|\bstatement of work\b", 2), (r"\bservice levels?\b|\bSLA\b|\buptime\b", 2), (r"\bdeliverables?\b", 1)),
        "scope of services and deliverables, fees and payment terms, service levels and remedies, the customer's responsibilities, "
        "liability limits and indemnities, term, renewal and termination, and dispute resolution",
        (_t("Scope of services", r"scope|services|deliverable"), PAYMENT, _t("Service levels", r"service level|\bsla\b|uptime|response time"),
         LIABILITY, TERMINATION, _t("Renewal", r"renew"), DISPUTES, GOVERNING_LAW),
    ),
    DocType(
        "vendor", "Vendor, supply or business contract",
        ((r"\b(?:supply|purchase|vendor|distribution|sales|procurement) (?:agreement|contract)\b|\bpurchase order\b", 6), (r"\bsupplier\b|\bvendor\b|\bbuyer\b|\bpurchaser\b", 2),
         (r"\bgoods\b|\bproducts?\b", 1.5), (r"\bdelivery\b", 1), (r"\bwarrant(?:y|ies)\b", 1)),
        "what is supplied, price and payment terms, delivery and acceptance, warranties, liability and indemnities, "
        "exclusivity or minimum commitments, termination, and dispute resolution",
        (_t("What is supplied", r"goods|products|supply|services"), PAYMENT, _t("Delivery and acceptance", r"deliver|accept"), _t("Warranties", r"warrant"),
         LIABILITY, TERMINATION, DISPUTES, GOVERNING_LAW),
    ),
    DocType(
        "partnership", "Partnership agreement",
        ((r"\bpartnership (?:agreement|deed)\b|\bdeed of partnership\b", 7), (r"\bpartners?\b", 1.5), (r"\bprofit(?:s)? (?:and|&) loss(?:es)?\b|\bprofit[- ]sharing\b", 3),
         (r"\bcapital contribution\b", 3), (r"\bretire(?:ment)?\b|\bdissolution\b", 1.5)),
        "capital contributions, profit and loss sharing, roles and decision-making, withdrawals and salaries, admission or exit of partners, "
        "dissolution, non-compete, and dispute resolution",
        (_t("Capital contributions", r"capital|contribut"), _t("Profit and loss sharing", r"profit|loss"), _t("Decision-making", r"decision|vote|consent|majority|manage"),
         _t("Exit or retirement of a partner", r"retire|withdraw|exit|admission|admit"), _t("Dissolution", r"dissol|wind"), DISPUTES),
    ),
    DocType(
        "terms", "Terms and conditions",
        ((r"\bterms (?:and|&) conditions\b|\bterms of (?:service|use)\b|\buser agreement\b|\bend user licen[cs]e agreement\b|\bEULA\b", 7),
         (r"\bby (?:using|accessing|creating an account)\b", 3), (r"\bwe may (?:change|modify|suspend|terminate)\b", 2), (r"\bour (?:website|app|platform|services)\b", 2)),
        "what the user agrees to, fees, auto-renewal and cancellation, how the provider may change the terms, suspension or termination of accounts, "
        "use of user content and data, limits on the provider's liability, and how disputes are handled",
        (_t("Fees or charges", r"fee|charge|price|subscription|payment"), _t("Cancellation or termination", r"cancel|terminat|suspend"),
         _t("Changes to the terms", r"(?:change|modify|update|amend).{0,40}terms|terms.{0,40}(?:change|modif|update|amend)"),
         _t("Use of your content or data", r"content|data|licen[cs]e"), LIABILITY, DISPUTES, GOVERNING_LAW),
    ),
    DocType(
        "general", "Other legal document",
        (),
        "obligations, rights, deadlines, payments, penalties, termination, renewal, unclear or one-sided wording",
        (TERMINATION, _t("Notice period", r"\bnotice\b"), PAYMENT,
         _t("Penalties, late fees or interest", r"penalt|late fee|late charge|\binterest\b|liquidated damages|\bfines?\b|forfeit"),
         DISPUTES, GOVERNING_LAW, LIABILITY),
    ),
)

BY_ID = {t.id: t for t in TYPES}
GENERAL = BY_ID["general"]
_COMPILED = {t.id: [(re.compile(p, re.I), w) for p, w in t.signals] for t in TYPES}


@dataclass(frozen=True)
class Detection:
    type: DocType
    confidence: str  # "high" | "low"
    alternatives: tuple[str, ...]  # other plausible type ids, best first


def detect(text: str) -> Detection:
    """Score each type on the title lines (counted three times) and the opening of the body."""
    head = "\n".join(line for line in text.splitlines()[:6] if line.strip())
    body = text[:20000]
    scores: dict[str, float] = {}
    for t in TYPES:
        s = 0.0
        for pattern, weight in _COMPILED[t.id]:
            n = len(pattern.findall(body))
            if n:
                s += weight * (1 + math.log(n))
            if pattern.search(head):
                s += 2 * weight
        scores[t.id] = s
    ranked = sorted((tid for tid in scores if tid != "general"), key=lambda tid: scores[tid], reverse=True)
    best = ranked[0]
    top, second = scores[best], scores[ranked[1]]
    if top < 4:
        return Detection(GENERAL, "low", tuple(t for t in ranked[:2] if scores[t] > 0))
    confidence = "high" if top >= 8 and top >= 1.6 * second else "low"
    alternatives = tuple(t for t in ranked[1:3] if scores[t] >= 0.5 * top)
    return Detection(BY_ID[best], confidence, alternatives)
