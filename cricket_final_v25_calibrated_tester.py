#!/usr/bin/env python3
"""
V21 ODI/Test Fixed Engine - Python replica for fast stress testing.

This ports the V21 browser engine math into Python:
- skill vs skill
- contact mix: missed / edged / mistimed / controlled / middled
- outcome weights
- confidence/fatigue
- bowler stamina/fatigue ramp
- T20/ODI/Test format phases
- limited-overs two-innings match flow and Test four-innings flow

Important: Python's random generator is not the same as browser Math.random(), so
one ball will not match the browser ball-for-ball. The formulas and distributions
are matched for testing/tuning.
"""

from __future__ import annotations

import argparse
import copy
import json
import math
import random
import statistics
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

Outcome = Union[int, str]
Player = Dict[str, Any]

ENGINE_VERSION = "V25 calibrated team-strength engine - Python tester"
COMPUTER_BOWLING_PATTERN = "ABABCDECDEABCDEDCEAB"
COMPUTER_BOWLING_PATTERN_DISPLAY = "ABABCDECDE ABCDEDCEAB"
COMPUTER_BOWLING_SLOTS = ["A", "B", "C", "D", "E"]

# V25 calibration: soft country/team strength layer.
# This is not an outcome override. It only nudges batting/bowling pressure before the normal
# skill/contact/cap system rolls the ball. Values are intentionally small and transparent.
TEAM_CALIBRATION = {
    "Zimbabwe": {"batting": 0.80, "bowling": 0.20},
    "India": {"batting": 0.10, "bowling": -0.05},
    "Australia": {"batting": 0.12, "bowling": 0.82},
    "Bangladesh": {"batting": 0.00, "bowling": 0.55},
    "England": {"batting": 0.18, "bowling": 0.85},
    "Namibia": {"batting": -0.20, "bowling": -0.30},
    "Afghanistan": {"batting": 0.25, "bowling": 1.20},
}

def get_team_calibration(team_name: str, side: str) -> float:
    data = TEAM_CALIBRATION.get(str(team_name or "").strip(), {})
    return float(data.get(side, 0.0) or 0.0)



def js_number(value: Any, fallback: float = 0.0) -> float:
    """Close enough to JS Number(...) for our player attributes."""
    if value is None:
        return fallback
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    if isinstance(value, (int, float)) and math.isfinite(float(value)):
        return float(value)
    try:
        text = str(value).strip()
        if text == "":
            return 0.0
        number = float(text)
        return number if math.isfinite(number) else fallback
    except Exception:
        return fallback


def clamp_number(value: Any, min_value: float, max_value: float) -> float:
    number = js_number(value, 0.0)
    return max(min_value, min(max_value, number))


def weighted_average(items: List[Tuple[Any, Any]]) -> float:
    total = 0.0
    weight = 0.0
    for value, item_weight in items:
        number_value = js_number(value, math.nan)
        number_weight = js_number(item_weight, math.nan)
        if math.isfinite(number_value) and math.isfinite(number_weight) and number_weight > 0:
            total += number_value * number_weight
            weight += number_weight
    return total / weight if weight > 0 else 0.0


def round1(value: float) -> float:
    return round(float(value) + 1e-12, 1)


def round2(value: float) -> float:
    return round(float(value) + 1e-12, 2)


def score_from_twenty_scale(value20: float) -> float:
    safe = clamp_number(value20, 0, 20) / 20
    return 42 + math.pow(safe, 1.18) * 56


def get_nested(obj: Any, path: str, default: Any = None) -> Any:
    current = obj
    for key in str(path).split("."):
        if not isinstance(current, dict) or key not in current:
            return default
        current = current[key]
    return current


def attribute_number(player: Player, path: str, fallback: float = 0.0) -> float:
    value = get_nested(player, path, None)
    number_value = js_number(value, math.nan)
    return number_value if math.isfinite(number_value) else fallback


def get_player_key(player: Optional[Player], fallback: str = "player") -> str:
    p = player or {}
    for key in ["id", "playerId", "player_id", "final_cricinfo_id", "cricinfo_id", "master_cricinfo_id", "name", "fullName"]:
        value = p.get(key)
        if value is not None and str(value) != "":
            return str(value)
    return fallback


def get_player_name(player: Optional[Player]) -> str:
    p = player or {}
    for key in ["name", "fullName", "final_player_name", "final_short_name"]:
        value = p.get(key)
        if value:
            return str(value)
    info = p.get("player_info") if isinstance(p.get("player_info"), dict) else {}
    for key in ["final_player_name", "final_short_name"]:
        value = info.get(key)
        if value:
            return str(value)
    return "Player"


def get_format_key(format_value: str) -> str:
    key = str(format_value or "").strip().lower()
    if "test" in key:
        return "test"
    if "odi" in key:
        return "odi"
    if "t20" in key:
        return "t20"
    return key or "t20"


def get_format_max_overs(format_value: str) -> int:
    key = get_format_key(format_value)
    if key == "test":
        return 90
    if key == "odi":
        return 50
    return 20


def get_bowler_max_overs(format_value: str) -> Optional[int]:
    key = get_format_key(format_value)
    if key == "t20":
        return 4
    if key == "odi":
        return 10
    if key == "test":
        return None
    return 4


def get_bowler_max_balls(format_value: str) -> Optional[int]:
    max_overs = get_bowler_max_overs(format_value)
    return None if max_overs is None else max_overs * 6


def balls_to_overs(balls: int) -> str:
    total = int(balls or 0)
    return f"{total // 6}.{total % 6}"


def balls_to_delivery_label(delivery_number: int) -> str:
    delivery = max(1, int(delivery_number or 1))
    over = (delivery - 1) // 6
    ball = ((delivery - 1) % 6) + 1
    return f"{over}.{ball}"


def get_run_rate(runs: int, balls: int) -> str:
    if balls <= 0:
        return "0.00"
    return f"{runs / (balls / 6):.2f}"


def is_no_bowling_value(value: Any) -> bool:
    text = str(value if value is not None else "").strip().lower()
    return text in {"", "-", "none", "null", "n/a", "does not bowl"}


def get_bowler_type(player: Optional[Player]) -> str:
    p = player or {}
    typ = str(p.get("bowlingType") or p.get("bowling_type") or "").lower()
    style = str(p.get("bowlingStyle") or p.get("bowling_style") or "").lower()
    if "spin" in typ:
        return "spin"
    if "pace" in typ or "fast" in typ or "medium" in typ:
        return "pace"
    if any(word in style for word in ["spin", "break", "orthodox", "googly", "leg", "off", "slow"]):
        return "spin"
    if any(word in style for word in ["fast", "medium", "seam", "swing"]):
        return "pace"
    return "pace"


def get_role_group_for_skill(player: Optional[Player]) -> str:
    p = player or {}
    role = str(p.get("role") or p.get("playerRole") or p.get("player_role") or "").lower()
    if "all-rounder" in role or "all rounder" in role or "allrounder" in role:
        return "allrounder"
    if "wicket" in role or "keeper" in role:
        return "wicketkeeper"
    if "bowler" in role or "bowl" in role:
        return "bowler"
    if "batsman" in role or "batter" in role or "bat" in role:
        return "batter"
    return "unknown"


def get_batting_role_multiplier(player: Optional[Player]) -> float:
    role = get_role_group_for_skill(player)
    if role == "batter":
        return 1.00
    if role == "wicketkeeper":
        return 0.98
    if role == "allrounder":
        return 0.92
    if role == "bowler":
        return 0.68
    return 0.86


def get_bowling_role_multiplier(player: Optional[Player]) -> float:
    role = get_role_group_for_skill(player)
    if role == "bowler":
        return 1.00
    if role == "allrounder":
        return 0.94
    if role == "batter":
        return 0.52
    if role == "wicketkeeper":
        return 0.42
    return 0.65


def get_batting_role_cap(player: Optional[Player]) -> float:
    role = get_role_group_for_skill(player)
    batting_overall = attribute_number(player or {}, "attributes.overall.batting_overall", 0)
    if role == "batter":
        return clamp_number(62 + batting_overall * 1.75, 78, 98)
    if role == "wicketkeeper":
        return clamp_number(60 + batting_overall * 1.70, 76, 96)
    if role == "allrounder":
        return clamp_number(56 + batting_overall * 1.55, 70, 91)
    if role == "bowler":
        return clamp_number(46 + batting_overall * 1.45, 54, 82)
    return clamp_number(54 + batting_overall * 1.45, 62, 86)


def get_bowling_role_cap(player: Optional[Player]) -> float:
    role = get_role_group_for_skill(player)
    bowling_overall = attribute_number(player or {}, "attributes.overall.bowling_overall", 0)
    if role == "bowler":
        return clamp_number(62 + bowling_overall * 1.75, 78, 98)
    if role == "allrounder":
        return clamp_number(58 + bowling_overall * 1.60, 72, 92)
    if role == "batter":
        return clamp_number(26 + bowling_overall * 1.45, 30, 58)
    if role == "wicketkeeper":
        return clamp_number(22 + bowling_overall * 1.25, 26, 50)
    return clamp_number(42 + bowling_overall * 1.55, 50, 82)


def apply_batting_role_reality(score: float, player: Optional[Player]) -> float:
    adjusted = score * get_batting_role_multiplier(player)
    return round1(min(adjusted, get_batting_role_cap(player)))


def apply_bowling_role_reality(score: float, player: Optional[Player]) -> float:
    adjusted = score * get_bowling_role_multiplier(player)
    return round1(min(adjusted, get_bowling_role_cap(player)))


def get_player_bowling_overall(player: Optional[Player]) -> float:
    return attribute_number(player or {}, "attributes.overall.bowling_overall", 0)


def get_player_stamina_rating(player: Optional[Player]) -> float:
    p = player or {}
    physical = p.get("attributes", {}).get("physical", {}) if isinstance(p.get("attributes"), dict) else {}
    return js_number(physical.get("stamina") or physical.get("endurance") or physical.get("maxFitness") or 10, 10)


def get_initial_bowler_stamina(player: Optional[Player]) -> float:
    raw = get_player_stamina_rating(player)
    return max(45, min(100, round(raw * 5)))


def get_bowler_drain_per_ball(player: Optional[Player], format_value: str) -> float:
    key = get_format_key(format_value)
    stamina_rating = max(0, min(20, get_player_stamina_rating(player)))
    base_drain = 1.05 if key == "test" else 1.25 if key == "odi" else 1.45
    return max(0.55, round2(base_drain - stamina_rating * 0.025))


def get_bowler_candidate_tier(player: Optional[Player]) -> int:
    p = player or {}
    role = str(p.get("role") or p.get("playerRole") or "").lower()
    bowl_type = str(p.get("bowlingType") or p.get("bowling_type") or "").lower()
    bowl_style = str(p.get("bowlingStyle") or p.get("bowling_style") or "").lower()
    bowl_overall = get_player_bowling_overall(p)
    if is_no_bowling_value(bowl_type) and is_no_bowling_value(bowl_style) and bowl_overall <= 0:
        return 0
    if "bowler" in role:
        return 3
    if "all" in role:
        return 2
    has_real_style = ((not is_no_bowling_value(bowl_type)) and bowl_type != "batter") or (not is_no_bowling_value(bowl_style))
    if has_real_style and bowl_overall >= 8:
        return 1
    if bowl_overall >= 10:
        return 1
    return 0


def is_bowler_candidate(player: Optional[Player]) -> bool:
    return get_bowler_candidate_tier(player) > 0


def rank_bowlers(bowling_xi: List[Player]) -> List[Player]:
    players = list(bowling_xi or [])
    candidates = [p for p in players if is_bowler_candidate(p)]
    pool = candidates if candidates else players

    def selection_score(p: Player) -> Tuple[float, float, float, float]:
        # V22: bowling attributes matter more than the text role.
        # This lets a strong all-rounder like Sikandar Raza beat a weak specialist bowler.
        overall = get_player_bowling_overall(p)
        top = p.get("topPlaystyles") if isinstance(p.get("topPlaystyles"), dict) else {}
        arr = top.get("bowling") if isinstance(top.get("bowling"), list) else []
        style_rating = max([js_number(x.get("rating"), 0) for x in arr if isinstance(x, dict)] or [0])
        tier = get_bowler_candidate_tier(p)
        stamina = get_player_stamina_rating(p)
        blended = overall * 4.0 + style_rating * 0.22 + tier * 2.0 + stamina * 0.25
        return (blended, overall, style_rating, stamina)

    return sorted(pool, key=selection_score, reverse=True)


def build_computer_bowling_pattern_plan(bowling_xi: List[Player], format_value: str = "T20") -> Optional[Dict[str, Any]]:
    players = list(bowling_xi or [])
    if not players:
        return None
    ranked = rank_bowlers(players)
    selected: List[Player] = []
    used: set[str] = set()
    for player in ranked + players:
        if not player or len(selected) >= len(COMPUTER_BOWLING_SLOTS):
            continue
        key = get_player_key(player, f"pattern_{len(selected)}")
        if key in used:
            continue
        used.add(key)
        selected.append(player)
    if not selected:
        return None
    while len(selected) < len(COMPUTER_BOWLING_SLOTS):
        selected.append(selected[len(selected) % max(1, len(selected))])
    bowlers_by_slot = {}
    keys_by_slot = {}
    names_by_slot = {}
    for slot, player in zip(COMPUTER_BOWLING_SLOTS, selected):
        key = get_player_key(player, f"pattern_{slot}")
        bowlers_by_slot[slot] = player
        keys_by_slot[slot] = key
        names_by_slot[slot] = get_player_name(player)
    return {
        "enabled": True,
        "pattern": COMPUTER_BOWLING_PATTERN,
        "displayPattern": COMPUTER_BOWLING_PATTERN_DISPLAY,
        "slots": COMPUTER_BOWLING_SLOTS,
        "bowlersBySlot": bowlers_by_slot,
        "keysBySlot": keys_by_slot,
        "namesBySlot": names_by_slot,
        "formatMaxOvers": get_bowler_max_overs(format_value),
    }




# ---------- V22 playstyle helpers ----------

def get_primary_playstyle_name(player: Optional[Player], category: str) -> str:
    p = player or {}
    primary = p.get("primaryPlaystyle") if isinstance(p.get("primaryPlaystyle"), dict) else {}
    value = primary.get(category)
    if value:
        return str(value)
    top = p.get("topPlaystyles") if isinstance(p.get("topPlaystyles"), dict) else {}
    arr = top.get(category) if isinstance(top.get(category), list) else []
    if arr and isinstance(arr[0], dict) and arr[0].get("name"):
        return str(arr[0].get("name"))
    return ""


def get_top_playstyle_rating(player: Optional[Player], category: str, style_name: str = "") -> float:
    p = player or {}
    style_name_l = str(style_name or "").lower()
    top = p.get("topPlaystyles") if isinstance(p.get("topPlaystyles"), dict) else {}
    arr = top.get(category) if isinstance(top.get(category), list) else []
    best = 0.0
    for item in arr:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "")
        rating = js_number(item.get("rating"), 0)
        if not style_name_l or style_name_l in name.lower() or name.lower() in style_name_l:
            best = max(best, rating)
    return best


def get_default_batting_tier(player: Optional[Player]) -> str:
    tactics = (player or {}).get("tactics") if isinstance((player or {}).get("tactics"), dict) else {}
    return str(tactics.get("defaultBattingTier") or "")


def get_default_bowling_plan_text(player: Optional[Player]) -> str:
    tactics = (player or {}).get("tactics") if isinstance((player or {}).get("tactics"), dict) else {}
    plans = tactics.get("defaultBowlingPlans") if isinstance(tactics.get("defaultBowlingPlans"), dict) else {}
    return f"{plans.get('lineLength','')} {plans.get('variation','')}".strip()


def get_batting_playstyle_tags(player: Optional[Player]) -> Dict[str, Any]:
    name = get_primary_playstyle_name(player, "batting")
    tier = get_default_batting_tier(player)
    text = f"{name} {tier}".lower()
    rating = get_top_playstyle_rating(player, "batting", name)
    return {
        "name": name or tier or "Unknown",
        "rating": round1(rating),
        "is_slogger": "slogger" in text or "blitz" in text,
        "is_anchor": "anchor" in text or "wall" in text or "rotate" in text,
        "is_balanced": "balanced" in text or "cruise" in text,
        "is_finisher": "finisher" in text,
        "is_runner": "runner" in text,
        "is_pinch": "pinch" in text,
        "is_opener": "opener" in text,
        "is_top": "top order" in text,
        "is_middle": "middle order" in text,
        "is_lower": "lower order" in text,
    }


def get_bowling_playstyle_tags(player: Optional[Player]) -> Dict[str, Any]:
    name = get_primary_playstyle_name(player, "bowling")
    plan = get_default_bowling_plan_text(player)
    text = f"{name} {plan}".lower()
    rating = get_top_playstyle_rating(player, "bowling", name)
    return {
        "name": name or plan or "Unknown",
        "rating": round1(rating),
        "is_swing": "swing" in text or "seam" in text or "attacking line" in text,
        "is_hitdeck": "hit-the-deck" in text or "wide line" in text or "consistent accuracy" in text,
        "is_shortball": "short-ball" in text or "short-pitched" in text or "bouncer" in text,
        "is_death": "death" in text or "yorker" in text or "pace variation mix" in text,
        "is_classical": "classical" in text or "flight" in text or "loop" in text,
        "is_flat": "flat" in text or "flat & fast" in text,
        "is_mystery": "mystery" in text or "turn candy" in text,
        "is_containment": "containment" in text or "defensive" in text,
    }


def apply_v22_playstyle_phase_modifiers(
    weights: Dict[str, float],
    batter: Optional[Player],
    bowler: Optional[Player],
    format_key: str,
    phase: str,
    agg: float,
    skill_edge: float,
    over_now: float,
) -> Dict[str, Any]:
    """Apply playstyle labels/tactics on top of raw attributes.

    This is intentionally moderate. Raw skill still drives the contest; styles shape how that skill expresses itself.
    """
    bat = get_batting_playstyle_tags(batter)
    bowl = get_bowling_playstyle_tags(bowler)
    notes: List[str] = []
    cap_delta = {"boundary": 0.0, "six": 0.0, "wicket_cap": 0.0, "wicket_floor": 0.0}
    attack = clamp_number((agg - 1) / 9, 0, 1)
    batting_rating_scale = clamp_number((bat.get("rating") or 55) / 85, 0.55, 1.20)
    bowling_rating_scale = clamp_number((bowl.get("rating") or 55) / 85, 0.55, 1.20)
    is_limited_death = (format_key == "t20" and phase == "death") or (format_key == "odi" and phase == "death")
    is_pp_or_new = phase in {"powerplay", "newBall"}
    is_middle = phase in {"earlyMiddle", "lateMiddle", "middle", "setup", "oldBall"}

    # Batter identities
    if bat["is_slogger"]:
        boost = 1.0 + 0.050 * batting_rating_scale + 0.030 * attack
        weights["four"] *= boost
        weights["six"] *= 1.0 + 0.080 * batting_rating_scale + 0.040 * attack
        weights["wicket"] *= 1.0 + 0.045 * attack
        weights["one"] *= 0.980
        cap_delta["boundary"] += 0.55 * batting_rating_scale
        cap_delta["six"] += 0.30 * batting_rating_scale
        cap_delta["wicket_floor"] += 0.10 * attack
        notes.append("bat:slogger")
    if bat["is_pinch"] and is_pp_or_new:
        weights["four"] *= 1.10
        weights["six"] *= 1.10
        weights["wicket"] *= 1.08
        cap_delta["boundary"] += 0.9
        cap_delta["six"] += 0.35
        notes.append("bat:pinch-pp")
    if bat["is_finisher"] and is_limited_death:
        weights["four"] *= 1.13
        weights["six"] *= 1.16
        weights["wicket"] *= 1.04
        weights["dot"] *= 0.96
        cap_delta["boundary"] += 1.20 * batting_rating_scale
        cap_delta["six"] += 0.55 * batting_rating_scale
        notes.append("bat:finisher-death")
    if bat["is_anchor"]:
        weights["one"] *= 1.060
        weights["two"] *= 1.050
        weights["wicket"] *= 0.925
        weights["six"] *= 0.900
        if format_key == "test":
            weights["dot"] *= 1.035
            weights["four"] *= 0.970
        cap_delta["wicket_floor"] -= 0.12 * batting_rating_scale
        notes.append("bat:anchor")
    if bat["is_balanced"]:
        weights["one"] *= 1.035
        weights["two"] *= 1.035
        weights["wicket"] *= 0.975
        notes.append("bat:balanced")
    if bat["is_runner"]:
        weights["one"] *= 1.075
        weights["two"] *= 1.080
        weights["three"] *= 1.120
        weights["six"] *= 0.820
        weights["wicket"] *= 0.965
        cap_delta["six"] -= 0.25
        notes.append("bat:runner")

    # Position style phase nudges
    if bat["is_opener"] and is_pp_or_new and format_key in {"t20", "odi"}:
        weights["four"] *= 1.035
        weights["wicket"] *= 1.010
        cap_delta["boundary"] += 0.25
        notes.append("bat:opener-pp")
    if (bat["is_middle"] or bat["is_lower"]) and is_limited_death and not bat["is_runner"]:
        weights["four"] *= 1.035
        weights["six"] *= 1.040
        cap_delta["boundary"] += 0.35
        cap_delta["six"] += 0.18
        notes.append("bat:late-phase")

    # Bowler identities
    if bowl["is_swing"] and is_pp_or_new:
        weights["dot"] *= 1.060
        weights["wicket"] *= 1.070
        weights["four"] *= 0.950
        weights["six"] *= 0.920
        cap_delta["boundary"] -= 0.35 * bowling_rating_scale
        cap_delta["wicket_cap"] += 0.20 * bowling_rating_scale
        cap_delta["wicket_floor"] += 0.15 * bowling_rating_scale
        notes.append("bowl:swing-newball")
    if bowl["is_hitdeck"] and is_middle:
        weights["dot"] *= 1.045
        weights["wicket"] *= 1.040 + 0.020 * attack
        weights["six"] *= 0.960
        cap_delta["wicket_cap"] += 0.12 * bowling_rating_scale
        notes.append("bowl:hitdeck-middle")
    if bowl["is_shortball"]:
        if attack >= 0.55:
            weights["wicket"] *= 1.055
            weights["dot"] *= 1.020
            weights["four"] *= 1.015  # short ball can also be hit if missed plan
            weights["six"] *= 1.010
            cap_delta["wicket_cap"] += 0.18 * bowling_rating_scale
            notes.append("bowl:shortball-vs-attack")
    if bowl["is_death"] and is_limited_death:
        weights["dot"] *= 1.080
        weights["one"] *= 1.025
        weights["four"] *= 0.900
        weights["six"] *= 0.870
        weights["wicket"] *= 1.045
        cap_delta["boundary"] -= 1.15 * bowling_rating_scale
        cap_delta["six"] -= 0.55 * bowling_rating_scale
        cap_delta["wicket_cap"] += 0.18 * bowling_rating_scale
        cap_delta["wicket_floor"] += 0.10 * bowling_rating_scale
        notes.append("bowl:death-specialist")
    if bowl["is_containment"] and is_middle:
        weights["dot"] *= 1.050
        weights["one"] *= 1.035
        weights["four"] *= 0.900
        weights["six"] *= 0.820
        weights["wicket"] *= 0.985
        cap_delta["boundary"] -= 0.80 * bowling_rating_scale
        cap_delta["six"] -= 0.35 * bowling_rating_scale
        notes.append("bowl:containment-middle")
    if bowl["is_classical"] and is_middle:
        weights["dot"] *= 1.035
        weights["one"] *= 1.030
        weights["four"] *= 0.930
        weights["six"] *= 0.860
        cap_delta["boundary"] -= 0.55 * bowling_rating_scale
        cap_delta["six"] -= 0.25 * bowling_rating_scale
        notes.append("bowl:classical-spin")
    if bowl["is_flat"] and is_middle:
        weights["dot"] *= 1.025
        weights["one"] *= 1.055
        weights["two"] *= 1.020
        weights["four"] *= 0.930
        weights["six"] *= 0.870
        cap_delta["boundary"] -= 0.45 * bowling_rating_scale
        notes.append("bowl:flat-spin-control")
    if bowl["is_mystery"]:
        judgement = attribute_number(batter or {}, "attributes.mental.judgement", 10)
        judgement_gap = clamp_number((12 - judgement) / 8, 0, 1)
        if is_middle or is_limited_death:
            weights["dot"] *= 1.025
            weights["wicket"] *= 1.045 + 0.050 * judgement_gap
            weights["four"] *= 0.950
            weights["six"] *= 0.900
            cap_delta["wicket_cap"] += (0.12 + 0.18 * judgement_gap) * bowling_rating_scale
            cap_delta["wicket_floor"] += (0.08 + 0.12 * judgement_gap) * bowling_rating_scale
            notes.append("bowl:mystery")

    # Skill edge should also widen style impact, especially against weaker attacks.
    if skill_edge >= 1.5:
        edge_bonus = min(0.9, (skill_edge - 1.5) * 0.30)
        weights["four"] *= 1 + 0.025 * edge_bonus
        weights["six"] *= 1 + 0.020 * edge_bonus
        weights["wicket"] *= 1 - 0.018 * edge_bonus
        cap_delta["boundary"] += 0.35 * edge_bonus
        cap_delta["six"] += 0.12 * edge_bonus
        notes.append("edge:bat")
    elif skill_edge <= -1.5:
        edge_penalty = min(0.9, (-skill_edge - 1.5) * 0.30)
        weights["four"] *= 1 - 0.025 * edge_penalty
        weights["six"] *= 1 - 0.030 * edge_penalty
        weights["wicket"] *= 1 + 0.030 * edge_penalty
        cap_delta["boundary"] -= 0.30 * edge_penalty
        cap_delta["six"] -= 0.12 * edge_penalty
        cap_delta["wicket_cap"] += 0.18 * edge_penalty
        notes.append("edge:bowl")

    return {
        "battingStyle": bat["name"],
        "bowlingStyle": bowl["name"],
        "battingStyleRating": bat["rating"],
        "bowlingStyleRating": bowl["rating"],
        "capDelta": {k: round2(v) for k, v in cap_delta.items()},
        "notes": notes,
    }


@dataclass
class BatterStat:
    key: str
    name: str
    runs: int = 0
    balls: int = 0
    fours: int = 0
    sixes: int = 0
    out: bool = False
    howOut: str = ""
    confidence: float = 50
    lastConfidenceChange: float = 0
    fatigue: float = 0
    lastFatigueChange: float = 0


@dataclass
class BowlerStat:
    key: str
    name: str
    format: str = "T20"
    balls: int = 0
    maidens: int = 0
    runs: int = 0
    wickets: int = 0
    stamina: float = 75
    fatigue: float = 0
    spellBalls: int = 0
    maxOvers: Optional[int] = None
    maxBalls: Optional[int] = None
    lastOverBowled: Optional[int] = None
    lastFatigueChange: float = 0


@dataclass
class InningsSnapshot:
    inningsNumber: int
    battingTeam: str
    bowlingTeam: str
    battingSide: str
    bowlingSide: str
    runs: int
    wickets: int
    balls: int
    overs: str
    runRate: str


@dataclass
class MatchState:
    format: str
    maxOvers: int
    batting_xi: List[Player]
    bowling_xi: List[Player]
    battingTeam: str = "Batting Team"
    bowlingTeam: str = "Bowling Team"
    battingSide: str = "user"
    bowlingSide: str = "computer"
    runs: int = 0
    wickets: int = 0
    balls: int = 0
    strikerKey: str = ""
    nonStrikerKey: str = ""
    currentBowlerKey: str = ""
    previousBowlerKey: Optional[str] = None
    nextBatterIndex: int = 2
    battingStats: Dict[str, BatterStat] = field(default_factory=dict)
    bowlingStats: Dict[str, BowlerStat] = field(default_factory=dict)
    completed: bool = False
    matchCompleted: bool = False
    awaitingNextInnings: bool = False
    target: Optional[int] = None
    inningsNumber: int = 1
    inningsScorecards: List[InningsSnapshot] = field(default_factory=list)
    firstInnings: Optional[InningsSnapshot] = None
    secondInnings: Optional[InningsSnapshot] = None
    overHistory: List[Dict[str, Any]] = field(default_factory=list)
    bowlerPlan: Optional[Dict[str, Any]] = None
    lastSkillContest: Optional[Dict[str, Any]] = None
    partnershipRuns: int = 0
    partnershipBalls: int = 0


class V21Engine:
    def __init__(
        self,
        batting_xi: List[Player],
        bowling_xi: List[Player],
        format_value: str = "T20",
        batting_team: str = "Batting Team",
        bowling_team: str = "Bowling Team",
        batting_side: str = "user",
        bowling_side: str = "computer",
        seed: Optional[int] = None,
        use_computer_pattern: bool = True,
    ):
        self.rng = random.Random(seed)
        self.initial = {
            "batting_xi": copy.deepcopy(batting_xi),
            "bowling_xi": copy.deepcopy(bowling_xi),
            "format": format_value,
            "batting_team": batting_team,
            "bowling_team": bowling_team,
            "batting_side": batting_side,
            "bowling_side": bowling_side,
            "use_computer_pattern": use_computer_pattern,
        }
        self.state = self._create_innings_state(
            batting_xi=copy.deepcopy(batting_xi),
            bowling_xi=copy.deepcopy(bowling_xi),
            format_value=format_value,
            batting_team=batting_team,
            bowling_team=bowling_team,
            batting_side=batting_side,
            bowling_side=bowling_side,
            innings_number=1,
            target=None,
            use_computer_pattern=use_computer_pattern,
        )

    def reset_single_innings(self) -> None:
        args = self.initial
        self.state = self._create_innings_state(
            batting_xi=copy.deepcopy(args["batting_xi"]),
            bowling_xi=copy.deepcopy(args["bowling_xi"]),
            format_value=args["format"],
            batting_team=args["batting_team"],
            bowling_team=args["bowling_team"],
            batting_side=args["batting_side"],
            bowling_side=args["bowling_side"],
            innings_number=1,
            target=None,
            use_computer_pattern=args["use_computer_pattern"],
        )

    def _create_batter_stat(self, player: Player) -> BatterStat:
        return BatterStat(key=get_player_key(player), name=get_player_name(player))

    def _create_bowler_stat(self, player: Player, format_value: str) -> BowlerStat:
        return BowlerStat(
            key=get_player_key(player),
            name=get_player_name(player),
            format=format_value,
            stamina=get_initial_bowler_stamina(player),
            maxOvers=get_bowler_max_overs(format_value),
            maxBalls=get_bowler_max_balls(format_value),
        )

    def _create_innings_state(
        self,
        batting_xi: List[Player],
        bowling_xi: List[Player],
        format_value: str,
        batting_team: str,
        bowling_team: str,
        batting_side: str,
        bowling_side: str,
        innings_number: int,
        target: Optional[int],
        use_computer_pattern: bool,
    ) -> MatchState:
        plan = build_computer_bowling_pattern_plan(bowling_xi, format_value) if use_computer_pattern else None
        ranked = rank_bowlers(bowling_xi)
        opening_bowler = plan["bowlersBySlot"].get("A") if plan else (ranked[0] if ranked else (bowling_xi[0] if bowling_xi else {"name": "Bowler"}))
        second_bowler = plan["bowlersBySlot"].get("B") if plan else (ranked[1] if len(ranked) > 1 else None)
        striker = batting_xi[0] if len(batting_xi) > 0 else {"name": "Opening Batter"}
        non_striker = batting_xi[1] if len(batting_xi) > 1 else {"name": "Opening Batter"}
        striker_key = get_player_key(striker, "striker")
        non_striker_key = get_player_key(non_striker, "nonStriker")
        bowler_key = get_player_key(opening_bowler, "bowler")
        state = MatchState(
            format=format_value,
            maxOvers=get_format_max_overs(format_value),
            batting_xi=batting_xi,
            bowling_xi=bowling_xi,
            battingTeam=batting_team,
            bowlingTeam=bowling_team,
            battingSide=batting_side,
            bowlingSide=bowling_side,
            strikerKey=striker_key,
            nonStrikerKey=non_striker_key,
            currentBowlerKey=bowler_key,
            nextBatterIndex=2,
            inningsNumber=innings_number,
            target=target,
            bowlerPlan=plan,
        )
        state.battingStats[striker_key] = self._create_batter_stat(striker)
        state.battingStats[non_striker_key] = self._create_batter_stat(non_striker)
        state.bowlingStats[bowler_key] = self._create_bowler_stat(opening_bowler, format_value)
        if second_bowler:
            second_key = get_player_key(second_bowler, "bowler_2")
            state.bowlingStats.setdefault(second_key, self._create_bowler_stat(second_bowler, format_value))
        if plan:
            for slot, player in plan["bowlersBySlot"].items():
                key = plan["keysBySlot"][slot]
                state.bowlingStats.setdefault(key, self._create_bowler_stat(player, format_value))
        return state

    def get_batter_by_key(self, key: str) -> Optional[Player]:
        return next((p for p in self.state.batting_xi if get_player_key(p) == str(key)), None)

    def get_bowler_by_key(self, key: str) -> Optional[Player]:
        return next((p for p in self.state.bowling_xi if get_player_key(p) == str(key)), None)

    def ensure_batter_stat(self, key: str) -> BatterStat:
        if key not in self.state.battingStats:
            player = self.get_batter_by_key(key) or {"name": key}
            self.state.battingStats[key] = self._create_batter_stat(player)
        stat = self.state.battingStats[key]
        stat.confidence = stat.confidence if math.isfinite(float(stat.confidence)) else 50
        stat.lastConfidenceChange = stat.lastConfidenceChange if math.isfinite(float(stat.lastConfidenceChange)) else 0
        return stat

    def ensure_bowler_stat(self, key: str) -> BowlerStat:
        if key not in self.state.bowlingStats:
            player = self.get_bowler_by_key(key) or {"name": key}
            self.state.bowlingStats[key] = self._create_bowler_stat(player, self.state.format)
        stat = self.state.bowlingStats[key]
        player = self.get_bowler_by_key(key) or {"name": stat.name or key}
        stat.key = stat.key or key
        stat.name = stat.name or get_player_name(player)
        stat.stamina = stat.stamina if math.isfinite(float(stat.stamina)) else get_initial_bowler_stamina(player)
        stat.fatigue = stat.fatigue if math.isfinite(float(stat.fatigue)) else 0
        stat.maxOvers = get_bowler_max_overs(self.state.format)
        stat.maxBalls = get_bowler_max_balls(self.state.format)
        stat.spellBalls = stat.spellBalls or 0
        return stat

    def switch_strike(self) -> None:
        self.state.strikerKey, self.state.nonStrikerKey = self.state.nonStrikerKey, self.state.strikerKey

    def can_bowler_bowl_next_over(self, player: Optional[Player], exclude_current: bool = True) -> bool:
        if not player:
            return False
        key = get_player_key(player)
        stat = self.ensure_bowler_stat(key)
        if exclude_current and key == self.state.currentBowlerKey:
            return False
        if stat.maxBalls is not None and stat.balls >= stat.maxBalls:
            return False
        if js_number(stat.stamina, 0) <= 5:
            return False
        return True

    def _pattern_slot(self, over_index: int) -> str:
        return COMPUTER_BOWLING_PATTERN[max(0, int(over_index or 0)) % len(COMPUTER_BOWLING_PATTERN)]

    def choose_next_bowler(self) -> bool:
        completed_overs = self.state.balls // 6
        current_key = self.state.currentBowlerKey
        legal_pool = [p for p in rank_bowlers(self.state.bowling_xi) if self.can_bowler_bowl_next_over(p, True)]
        if not legal_pool:
            self.state.completed = True
            return False

        next_player = None
        plan = self.state.bowlerPlan
        if plan:
            keys_by_slot = plan.get("keysBySlot") or {}
            for offset in range(len(COMPUTER_BOWLING_PATTERN)):
                slot = self._pattern_slot(completed_overs + offset)
                wanted = keys_by_slot.get(slot)
                if not wanted:
                    continue
                for player in legal_pool:
                    if get_player_key(player) == wanted and self.can_bowler_bowl_next_over(player, True):
                        next_player = player
                        break
                if next_player:
                    break

        if not next_player:
            def bowler_score(player: Player) -> float:
                key = get_player_key(player)
                stat = self.ensure_bowler_stat(key)
                balls_left = 999 if stat.maxBalls is None else max(0, stat.maxBalls - stat.balls)
                return get_player_bowling_overall(player) * 3 + stat.stamina * 0.7 + balls_left * 0.12 - stat.balls * 0.08
            next_player = sorted(legal_pool, key=bowler_score, reverse=True)[0]

        self.state.previousBowlerKey = current_key
        self.state.currentBowlerKey = get_player_key(next_player)
        self.ensure_bowler_stat(self.state.currentBowlerKey).spellBalls = 0
        return True

    def get_batter_confidence(self, player_or_key: Union[str, Player]) -> float:
        key = player_or_key if isinstance(player_or_key, str) else get_player_key(player_or_key)
        stat = self.state.battingStats.get(str(key))
        return clamp_number(stat.confidence if stat else 50, 10, 99)

    def get_batter_confidence_adjustment(self, player_or_key: Union[str, Player], aggression: int) -> float:
        confidence = self.get_batter_confidence(player_or_key)
        agg = clamp_number(aggression, 1, 10)
        pressure_multiplier = 0.25 if agg >= 8 else 0.22 if agg >= 6 else 0.15 if agg <= 3 else 0.19
        raw_edge = confidence - 50
        sign = -1 if raw_edge < 0 else 1
        abs_edge = abs(raw_edge)
        if abs_edge <= 25:
            effective_edge = abs_edge
        elif abs_edge <= 40:
            effective_edge = 25 + (abs_edge - 25) * 0.55
        else:
            effective_edge = 25 + 15 * 0.55 + (abs_edge - 40) * 0.25
        return round1(sign * effective_edge * pressure_multiplier)

    def update_batter_confidence_after_outcome(self, batter_key: str, outcome: Outcome) -> float:
        stat = self.ensure_batter_stat(batter_key)
        before = clamp_number(stat.confidence, 10, 99)
        change = 0.0
        if outcome == "W":
            change = -18
        elif outcome == 0:
            change = -1.2
        elif outcome == 1:
            change = 0.7
        elif outcome == 2:
            change = 1.4
        elif outcome == 3:
            change = 1.9
        elif outcome == 4:
            change = 3.6
        elif outcome == 6:
            change = 4.9
        if stat.balls < 6 and change > 0:
            change *= 0.70
        if change > 0 and before >= 75:
            change *= 0.54
        if change > 0 and before >= 88:
            change *= 0.32
        if change > 0 and before >= 95:
            change *= 0.14
        stat.confidence = round1(clamp_number(before + change, 10, 96.5))
        stat.lastConfidenceChange = round1(stat.confidence - before)
        return stat.confidence

    def get_batter_fatigue(self, player_or_key: Union[str, Player]) -> float:
        key = player_or_key if isinstance(player_or_key, str) else get_player_key(player_or_key)
        stat = self.state.battingStats.get(str(key))
        return clamp_number(stat.fatigue if stat else 0, 0, 100)

    def get_batter_fatigue_gain_multiplier(self, player_or_key: Union[str, Player]) -> float:
        player = self.get_batter_by_key(player_or_key) if isinstance(player_or_key, str) else player_or_key
        stamina = attribute_number(player or {}, "attributes.physical.stamina", 10)
        fitness = attribute_number(player or {}, "attributes.physical.fitness", 10)
        endurance = attribute_number(player or {}, "attributes.physical.endurance", stamina or fitness or 10)
        physical20 = weighted_average([[stamina, 1.2], [fitness, 1.0], [endurance, 0.8]])
        return clamp_number(1.18 - (physical20 / 20) * 0.42, 0.70, 1.18)

    def get_batter_fatigue_adjustment(self, player_or_key: Union[str, Player]) -> float:
        fatigue = self.get_batter_fatigue(player_or_key)
        player = self.get_batter_by_key(player_or_key) if isinstance(player_or_key, str) else player_or_key
        stamina = attribute_number(player or {}, "attributes.physical.stamina", 10)
        fitness = attribute_number(player or {}, "attributes.physical.fitness", 10)
        resistance = clamp_number((stamina + fitness) / 40, 0.45, 1.0)
        penalty = fatigue * 0.080
        if fatigue > 35:
            penalty += (fatigue - 35) * 0.22
        if fatigue > 50:
            penalty += (fatigue - 50) * 0.34
        penalty *= (1.12 - resistance * 0.22)
        return round1(penalty)

    def update_batter_fatigue_after_outcome(self, batter_key: str, outcome: Outcome, aggression: int, is_runner: bool = False) -> float:
        stat = self.ensure_batter_stat(batter_key)
        before = clamp_number(stat.fatigue, 0, 100)
        agg = clamp_number(aggression, 1, 10)
        gain = 0.10 if is_runner else 0.22
        numeric = outcome if isinstance(outcome, int) else math.nan
        if outcome == "W":
            gain = 0
        elif numeric == 0:
            gain += 0.04 if is_runner else 0.18
        elif numeric == 1:
            gain += 0.42 if is_runner else 0.52
        elif numeric == 2:
            gain += 0.82 if is_runner else 1.00
        elif numeric == 3:
            gain += 1.30 if is_runner else 1.55
        elif numeric == 4:
            gain += 0.04 if is_runner else 0.46
        elif numeric == 6:
            gain += 0.04 if is_runner else 0.62
        gain += max(0, agg - 5) * 0.16
        if agg <= 3:
            gain -= 0.06
        if not is_runner and stat.balls >= 30:
            gain += 0.18
        if not is_runner and stat.balls >= 60:
            gain += 0.28
        gain *= self.get_batter_fatigue_gain_multiplier(batter_key)
        gain = max(0, gain)
        stat.fatigue = round1(clamp_number(before + gain, 0, 100))
        stat.lastFatigueChange = round1(stat.fatigue - before)
        return stat.fatigue

    def get_bowler_fatigue_gain_per_ball(self, player: Optional[Player], stat: BowlerStat, format_value: str) -> float:
        key = get_format_key(format_value)
        role = get_role_group_for_skill(player)
        stamina_rating = clamp_number(get_player_stamina_rating(player), 0, 20)
        spell_ball = (stat.spellBalls or 0) + 1
        gain = 0.82 if key == "test" else 1.05 if key == "odi" else 1.34
        gain += max(0, spell_ball - 1) * (0.06 if key == "test" else 0.09 if key == "odi" else 0.14)
        if spell_ball >= 5:
            gain += 0.10 if key == "test" else 0.16 if key == "odi" else 0.24
        if role == "bowler":
            gain *= 0.92
        elif role == "allrounder":
            gain *= 1.00
        else:
            gain *= 1.22
        fitness_relief = clamp_number(1.20 - (stamina_rating / 20) * 0.42, 0.78, 1.20)
        gain *= fitness_relief
        old_balls = stat.balls or 0
        if key == "t20" and old_balls >= 18:
            gain += 0.14
        if key == "odi" and old_balls >= 36:
            gain += 0.10
        if key == "test" and old_balls >= 60:
            gain += 0.08
        return round1(clamp_number(gain, 0.45, 2.65 if key == "t20" else 2.25))

    def drain_bowler_stamina(self, bowler_key: str) -> float:
        bowler_player = self.get_bowler_by_key(bowler_key) or {"name": bowler_key}
        stat = self.ensure_bowler_stat(bowler_key)
        drain = get_bowler_drain_per_ball(bowler_player, self.state.format)
        fatigue_gain = self.get_bowler_fatigue_gain_per_ball(bowler_player, stat, self.state.format)
        stat.stamina = max(0, round2(js_number(stat.stamina, 0) - drain))
        stat.spellBalls = (stat.spellBalls or 0) + 1
        stat.fatigue = round1(clamp_number((stat.fatigue or 0) + fatigue_gain, 0, 100))
        stat.lastFatigueChange = fatigue_gain
        return stat.stamina

    def get_bowler_fatigue_adjustment(self, stat: Optional[BowlerStat]) -> float:
        fatigue = clamp_number(stat.fatigue if stat else 0, 0, 100)
        penalty = fatigue * 0.050
        if fatigue > 25:
            penalty += (fatigue - 25) * 0.085
        if fatigue > 45:
            penalty += (fatigue - 45) * 0.140
        return round1(penalty)

    def get_batter_skill_score(self, batter: Player, bowler: Player, aggression: int) -> float:
        agg = clamp_number(aggression, 1, 10)
        bowler_type = get_bowler_type(bowler)
        bo = attribute_number(batter, "attributes.overall.batting_overall", 0)
        technique = attribute_number(batter, "attributes.batting.technique", 0)
        timing = attribute_number(batter, "attributes.batting.timing", 0)
        placement = attribute_number(batter, "attributes.batting.placement", 0)
        footwork = attribute_number(batter, "attributes.batting.footwork", 0)
        range360 = attribute_number(batter, "attributes.batting.range360", 0)
        defensive = attribute_number(batter, "attributes.batting.defensiveShots", 0)
        neutral = attribute_number(batter, "attributes.batting.neutralShots", 0)
        attacking = attribute_number(batter, "attributes.batting.attackingShots", 0)
        vs_type = attribute_number(batter, "attributes.batting.vsSpin" if bowler_type == "spin" else "attributes.batting.vsPace", 0)
        creativity = attribute_number(batter, "attributes.batting.creativity", 0)
        concentration = attribute_number(batter, "attributes.mental.concentration", 0)
        judgement = attribute_number(batter, "attributes.mental.judgement", 0)
        mental_aggression = attribute_number(batter, "attributes.mental.aggression", 0)
        speed = attribute_number(batter, "attributes.physical.speed", 0)
        strength = attribute_number(batter, "attributes.physical.strength", 0)
        low_agg = max(0, 5 - agg)
        high_agg = max(0, agg - 5)
        controlled20 = weighted_average([
            [bo, 2.30], [technique, 1.35], [timing, 1.20], [placement, 1.00], [footwork, 0.80],
            [neutral, 0.65], [defensive, 0.75 + low_agg * 0.10], [vs_type, 1.35], [concentration, 0.85], [judgement, 1.05]
        ])
        attacking20 = weighted_average([
            [bo, 1.25], [timing, 1.05], [attacking, 1.20 + high_agg * 0.10], [range360, 0.75 + high_agg * 0.08],
            [creativity, 0.80], [strength, 0.55], [mental_aggression, 0.45 + high_agg * 0.08], [speed, 0.35]
        ])
        control_share = clamp_number(0.72 - high_agg * 0.025 + low_agg * 0.025, 0.58, 0.82)
        skill20 = controlled20 * control_share + attacking20 * (1 - control_share)
        base_score = apply_batting_role_reality(score_from_twenty_scale(skill20), batter)
        confidence_adjustment = self.get_batter_confidence_adjustment(batter, agg)
        fatigue_penalty = self.get_batter_fatigue_adjustment(batter)
        return round1(clamp_number(base_score + confidence_adjustment - fatigue_penalty, 10, get_batting_role_cap(batter)))

    def get_bowler_skill_score(self, bowler: Player) -> float:
        bowling_overall = attribute_number(bowler, "attributes.overall.bowling_overall", 0)
        accuracy = attribute_number(bowler, "attributes.bowling.accuracy", 0)
        bowling_speed = attribute_number(bowler, "attributes.bowling.bowlingSpeed", 0)
        swing = attribute_number(bowler, "attributes.bowling.swing", 0)
        turn = attribute_number(bowler, "attributes.bowling.turn", 0)
        flight = attribute_number(bowler, "attributes.bowling.flight", 0)
        variations = attribute_number(bowler, "attributes.bowling.variations", 0)
        intelligence = attribute_number(bowler, "attributes.bowling.intelligence", 0)
        defensive_bowling = attribute_number(bowler, "attributes.bowling.defensiveBowling", 0)
        neutral_bowling = attribute_number(bowler, "attributes.bowling.neutralBowling", 0)
        attacking_bowling = attribute_number(bowler, "attributes.bowling.attackingBowling", 0)
        temperament = attribute_number(bowler, "attributes.mental.temperament", 0)
        bowler_type = get_bowler_type(bowler)
        style_skill = weighted_average([[turn, 1.05], [flight, 0.85], [variations, 0.65], [intelligence, 0.55]]) if bowler_type == "spin" else weighted_average([[bowling_speed, 0.85], [swing, 1.05], [variations, 0.65], [accuracy, 0.45]])
        skill20 = weighted_average([
            [bowling_overall, 2.35], [accuracy, 1.35], [style_skill, 1.25], [variations, 1.05], [intelligence, 0.95],
            [defensive_bowling, 0.70], [neutral_bowling, 0.55], [attacking_bowling, 0.80], [temperament, 0.50]
        ])
        key = get_player_key(bowler)
        bowler_stat = self.state.bowlingStats.get(key)
        stamina = clamp_number(bowler_stat.stamina if bowler_stat else get_initial_bowler_stamina(bowler), 0, 100)
        stamina_multiplier = 0.82 + stamina / 540
        fatigue_penalty = self.get_bowler_fatigue_adjustment(bowler_stat)
        return round1(clamp_number(apply_bowling_role_reality(score_from_twenty_scale(skill20) * stamina_multiplier, bowler) - fatigue_penalty, 8, get_bowling_role_cap(bowler)))

    def _normalize_local(self, obj: Dict[str, float]) -> Dict[str, float]:
        clean = {key: max(0.01, js_number(value, 0.01)) for key, value in obj.items()}
        total = sum(clean.values()) or 1
        return {key: value / total for key, value in clean.items()}

    def _total_weight(self, weights: Dict[str, float]) -> float:
        return sum(max(0.10, js_number(value, 0)) for value in weights.values()) or 1

    def _chance(self, weights: Dict[str, float], key: str) -> float:
        return max(0.10, js_number(weights.get(key), 0)) / self._total_weight(weights) * 100

    def _cap_combined_chance(self, weights: Dict[str, float], keys: List[str], cap_pct: float, attack_index: float) -> Dict[str, float]:
        cap = clamp_number(cap_pct, 1, 80)
        total = self._total_weight(weights)
        current_weight = sum(max(0.10, js_number(weights.get(key), 0)) for key in keys)
        current_pct = current_weight / total * 100
        if current_pct <= cap or current_weight <= 0:
            return {"cap": round1(cap), "current": round1(current_pct), "removed": 0}
        non_target_weight = max(0.10, total - current_weight)
        desired_weight = (cap / 100) * non_target_weight / max(0.01, 1 - cap / 100)
        removed = max(0, current_weight - desired_weight)
        scale = desired_weight / current_weight
        for key in keys:
            weights[key] = max(0.10, js_number(weights.get(key), 0) * scale)
        weights["dot"] += removed * (0.34 + attack_index * 0.04)
        weights["one"] += removed * (0.42 - attack_index * 0.04)
        weights["two"] += removed * 0.13
        weights["wicket"] += removed * (0.11 + attack_index * 0.02)
        return {"cap": round1(cap), "current": round1(current_pct), "removed": round1(removed)}

    def _raise_minimum_chance(self, weights: Dict[str, float], key: str, min_pct: float, source_keys: List[str]) -> Dict[str, float]:
        min_value = clamp_number(min_pct, 0, 25)
        current_pct = self._chance(weights, key)
        if current_pct >= min_value:
            return {"min": round1(min_value), "current": round1(current_pct), "added": 0}
        total = self._total_weight(weights)
        current_weight = max(0.10, js_number(weights.get(key), 0))
        desired_weight = (min_value / 100) * (total - current_weight) / max(0.01, 1 - min_value / 100)
        needed = max(0, desired_weight - current_weight)
        available = sum(max(0, js_number(weights.get(src), 0) - 0.10) for src in source_keys)
        added = min(needed, available * 0.65)
        if added <= 0 or available <= 0:
            return {"min": round1(min_value), "current": round1(current_pct), "added": 0}
        for src in source_keys:
            room = max(0, js_number(weights.get(src), 0) - 0.10)
            weights[src] = max(0.10, js_number(weights.get(src), 0) - added * (room / available))
        weights[key] += added
        return {"min": round1(min_value), "current": round1(current_pct), "added": round1(added)}

    def _roll_weighted_outcome_with_debug(self, weights: Dict[str, float]) -> Dict[str, Any]:
        entries = [(k, v) for k, v in weights.items() if js_number(v, 0) > 0]
        total = sum(js_number(v, 0) for _, v in entries)
        original_roll = self.rng.random() * total
        remaining = original_roll
        chosen = "dot"
        for key, value in entries:
            remaining -= js_number(value, 0)
            if remaining <= 0:
                chosen = key
                break
        label_to_outcome: Dict[str, Outcome] = {"wicket": "W", "dot": 0, "one": 1, "two": 2, "three": 3, "four": 4, "six": 6}
        return {
            "outcome": label_to_outcome.get(chosen, 0),
            "chosenKey": chosen,
            "total": round2(total),
            "roll": round2(original_roll),
            "entries": [
                {"outcome": key, "weight": round2(value), "chance": round2((value / total) * 100) if total > 0 else 0}
                for key, value in entries
            ],
        }

    def pick_outcome(self, aggression: int, batter: Optional[Player] = None, bowler: Optional[Player] = None) -> Outcome:
        s = self.state
        agg = clamp_number(aggression, 1, 10)
        format_key = get_format_key(s.format)
        striker_player = batter or self.get_batter_by_key(s.strikerKey) or {}
        bowler_player = bowler or self.get_bowler_by_key(s.currentBowlerKey) or {}
        batter_score = self.get_batter_skill_score(striker_player, bowler_player, int(agg))
        bowler_score = self.get_bowler_skill_score(bowler_player)
        skill_edge = clamp_number((batter_score - bowler_score) / 10, -5, 5)
        bowler_stat = self.ensure_bowler_stat(s.currentBowlerKey)
        stamina = clamp_number(bowler_stat.stamina, 0, 100)
        bowler_fatigue = clamp_number(bowler_stat.fatigue, 0, 100)
        batter_confidence = self.get_batter_confidence(s.strikerKey)
        batter_fatigue = self.get_batter_fatigue(s.strikerKey)
        confidence_edge = clamp_number((batter_confidence - 50) / 12, -4, 4)
        batter_fatigue_rate = clamp_number(batter_fatigue / 100, 0, 1)
        bowler_fatigue_rate = clamp_number(bowler_fatigue / 100, 0, 1)
        attack_index = clamp_number((agg - 1) / 9, 0, 1)
        high_agg = max(0, agg - 6)
        low_agg = max(0, 5 - agg)
        over_now = s.balls / 6
        if format_key == "t20":
            phase = "powerplay" if over_now < 6 else "earlyMiddle" if over_now < 12 else "lateMiddle" if over_now < 16 else "death"
        elif format_key == "odi":
            phase = "powerplay" if over_now < 10 else "middle" if over_now < 35 else "setup" if over_now < 40 else "death"
        else:
            phase = "newBall" if over_now < 20 else "middle" if over_now < 60 else "oldBall" if over_now < 80 else "secondNewBall"

        positive_skill = max(skill_edge, 0)
        negative_skill = max(-skill_edge, 0)
        bowler_role_for_contest = get_role_group_for_skill(bowler_player)
        part_time_pressure = 1 if bowler_role_for_contest in {"batter", "wicketkeeper"} else 0.55 if bowler_role_for_contest == "unknown" else 0
        weak_bowler_edge = clamp_number((55 - bowler_score) / 10, 0, 3.8) + part_time_pressure
        raw_contact = {
            "missed": clamp_number(8 + negative_skill * 2.45 + attack_index * 4.0 + batter_fatigue_rate * 8.0 - confidence_edge * 1.2 - bowler_fatigue_rate * 2.6 - positive_skill * 0.55 - weak_bowler_edge * 0.90, 1.5, 24),
            "edged": clamp_number(4 + negative_skill * 1.65 + attack_index * 3.3 + batter_fatigue_rate * 4.0 - confidence_edge * 0.8 - bowler_fatigue_rate * 1.8 - positive_skill * 0.35 - weak_bowler_edge * 0.65, 0.9, 17),
            "mistimed": clamp_number(17 + attack_index * 7.0 + batter_fatigue_rate * 12.0 + negative_skill * 1.35 - confidence_edge * 0.8 - bowler_fatigue_rate * 2.1 - positive_skill * 0.55 - weak_bowler_edge * 0.70, 7, 35),
            "controlled": clamp_number(44 + skill_edge * 2.90 + confidence_edge * 2.35 - attack_index * 6.6 - batter_fatigue_rate * 8.0 + bowler_fatigue_rate * 1.3 + weak_bowler_edge * 1.55, 22, 62),
            "middled": clamp_number(10 + positive_skill * 2.75 + attack_index * 7.2 + confidence_edge * 1.35 - batter_fatigue_rate * 5.0 + bowler_fatigue_rate * 1.6 + weak_bowler_edge * 2.05, 3.5, 34),
        }
        contact_mix = self._normalize_local(raw_contact)
        contact_profiles = {
            "missed": {"dot": 88, "one": 2, "two": 0, "three": 0, "four": 0, "six": 0, "wicket": 10},
            "edged": {"dot": 34, "one": 22, "two": 3, "three": 0, "four": 13, "six": 0, "wicket": 28},
            "mistimed": {"dot": 37, "one": 30, "two": 9, "three": 1, "four": 15, "six": 2.5, "wicket": 5.5},
            "controlled": {"dot": 27, "one": 47, "two": 15.5, "three": 2, "four": 7.8, "six": 0.5, "wicket": 1.2},
            "middled": {"dot": 5, "one": 16, "two": 8, "three": 1.5, "four": 47, "six": 21.5, "wicket": 1.0},
        }
        weights = {"dot": 0.0, "one": 0.0, "two": 0.0, "three": 0.0, "four": 0.0, "six": 0.0, "wicket": 0.0}
        for contact_key, mix in contact_mix.items():
            for outcome_key, value in contact_profiles[contact_key].items():
                weights[outcome_key] += value * mix

        if format_key == "test":
            weights["dot"] *= 1.36; weights["one"] *= 1.14; weights["two"] *= 0.88; weights["three"] *= 0.72; weights["four"] *= 0.58; weights["six"] *= 0.18; weights["wicket"] *= 0.64
        elif format_key == "odi":
            weights["dot"] *= 1.08; weights["one"] *= 1.13; weights["two"] *= 1.12; weights["three"] *= 1.08; weights["four"] *= 0.88; weights["six"] *= 0.56; weights["wicket"] *= 0.78
        else:
            weights["dot"] *= 0.98; weights["one"] *= 1.02

        if format_key == "t20":
            if phase == "powerplay":
                weights["four"] *= 1.08; weights["six"] *= 1.03; weights["wicket"] *= 1.04
            elif phase == "death":
                weights["dot"] *= 0.94; weights["one"] *= 0.96; weights["four"] *= 1.08; weights["six"] *= 1.08; weights["wicket"] *= 1.12
        elif format_key == "odi":
            if phase == "powerplay":
                weights["dot"] *= 1.03; weights["four"] *= 1.05; weights["six"] *= 0.95; weights["wicket"] *= 0.95
            elif phase == "middle":
                weights["dot"] *= 1.04; weights["one"] *= 1.08; weights["two"] *= 1.08; weights["four"] *= 0.86; weights["six"] *= 0.72; weights["wicket"] *= 0.84
            elif phase == "setup":
                weights["one"] *= 1.05; weights["two"] *= 1.08; weights["four"] *= 0.98; weights["six"] *= 0.88; weights["wicket"] *= 0.92
            elif phase == "death":
                weights["dot"] *= 0.94; weights["one"] *= 0.96; weights["two"] *= 1.12; weights["four"] *= 1.16; weights["six"] *= 1.12; weights["wicket"] *= 1.05
        else:
            if phase == "newBall":
                weights["dot"] *= 1.10; weights["four"] *= 0.92; weights["six"] *= 0.70; weights["wicket"] *= 1.16
            elif phase == "middle":
                weights["one"] *= 1.07; weights["two"] *= 1.03; weights["wicket"] *= 0.88
            elif phase == "oldBall":
                weights["dot"] *= 0.96; weights["one"] *= 1.08; weights["two"] *= 1.10; weights["four"] *= 1.08; weights["wicket"] *= 0.86
            elif phase == "secondNewBall":
                weights["dot"] *= 1.08; weights["four"] *= 0.96; weights["wicket"] *= 1.12

        weights["dot"] *= 1 - high_agg * 0.030 + low_agg * 0.040
        weights["one"] *= 1 - high_agg * 0.025 + low_agg * 0.060
        weights["two"] *= 1 + high_agg * 0.020 + low_agg * 0.015
        weights["four"] *= 1 + high_agg * 0.070 - low_agg * 0.080
        weights["six"] *= 1 + high_agg * 0.090 - low_agg * 0.120
        weights["wicket"] *= 1 + high_agg * 0.045 - low_agg * 0.060
        if format_key == "test":
            weights["dot"] *= 1 + low_agg * 0.035
            weights["one"] *= 1 + low_agg * 0.025
            weights["four"] *= 1 - low_agg * 0.045 + high_agg * 0.030
            weights["six"] *= 1 - low_agg * 0.090 + high_agg * 0.045
            weights["wicket"] *= 0.86 if agg <= 5 else 1 + high_agg * 0.055
        elif format_key == "odi":
            weights["one"] *= 1 + low_agg * 0.025
            weights["two"] *= 1 + low_agg * 0.020
            weights["four"] *= 1 - low_agg * 0.035 + high_agg * 0.045
            weights["six"] *= 1 - low_agg * 0.060 + high_agg * 0.055
            weights["wicket"] *= 1 + high_agg * 0.030 - low_agg * 0.035

        batter_role = get_role_group_for_skill(striker_player)
        if batter_role == "bowler":
            weights["dot"] *= 1.10; weights["four"] *= 0.74; weights["six"] *= 0.55; weights["wicket"] *= 1.18
        elif batter_role == "allrounder":
            weights["four"] *= 0.93; weights["six"] *= 0.88; weights["wicket"] *= 1.05
        elif batter_role == "wicketkeeper":
            weights["four"] *= 1.02; weights["six"] *= 1.02

        # V22: playstyle labels and phase roles shape the same raw skill contest.
        playstyle_info = apply_v22_playstyle_phase_modifiers(
            weights, striker_player, bowler_player, format_key, phase, agg, skill_edge, over_now
        )

        # V24: stronger skill-to-outcome conversion.
        # V23 separated weak/elite attacks, but the gap was still too conservative.
        # V24 widens the conversion from skill edge + bowling quality into 4/6/W chances
        # without hardcoding teams.
        elite_bowler_pressure = clamp_number((bowler_score - 78) / 12, 0, 1.65)
        weak_bowling_pressure = clamp_number((74 - bowler_score) / 16, 0, 1.85) + clamp_number(weak_bowler_edge / 4, 0, 0.85)
        positive_skill_pressure = clamp_number(positive_skill, 0, 4.5)
        negative_skill_pressure = clamp_number(negative_skill, 0, 4.5)
        phase_attack_multiplier = 1.0
        if format_key == "t20" and phase == "death":
            phase_attack_multiplier = 1.18
        elif format_key == "odi" and phase == "death":
            phase_attack_multiplier = 1.12
        elif format_key == "test":
            phase_attack_multiplier = 0.62

        bat_boundary_push = (0.062 * positive_skill_pressure + 0.100 * weak_bowling_pressure) * phase_attack_multiplier
        bowl_boundary_hold = (0.056 * negative_skill_pressure + 0.110 * elite_bowler_pressure) * phase_attack_multiplier
        weights["four"] *= clamp_number(1 + bat_boundary_push - bowl_boundary_hold, 0.66, 1.43)
        weights["six"] *= clamp_number(1 + (0.068 * positive_skill_pressure + 0.125 * weak_bowling_pressure - 0.070 * negative_skill_pressure - 0.110 * elite_bowler_pressure) * phase_attack_multiplier, 0.52, 1.58)
        weights["dot"] *= clamp_number(1 - (0.026 * positive_skill_pressure + 0.046 * weak_bowling_pressure) + (0.038 * negative_skill_pressure + 0.054 * elite_bowler_pressure), 0.80, 1.28)
        weights["one"] *= clamp_number(1 + 0.012 * positive_skill_pressure - 0.012 * elite_bowler_pressure + 0.006 * weak_bowling_pressure, 0.93, 1.08)
        weights["two"] *= clamp_number(1 + 0.018 * positive_skill_pressure + 0.020 * weak_bowling_pressure - 0.018 * elite_bowler_pressure, 0.90, 1.12)
        weights["wicket"] *= clamp_number(1 - 0.048 * positive_skill_pressure - 0.060 * weak_bowling_pressure + 0.070 * negative_skill_pressure + 0.086 * elite_bowler_pressure, 0.58, 1.56)

        # V25: transparent team calibration layer. It nudges the same outcome weights
        # by batting-team strength versus bowling-team strength so database outliers
        # can be calibrated without hardcoding winners or final scores.
        batting_team_strength = get_team_calibration(s.battingTeam, "batting")
        bowling_team_strength = get_team_calibration(s.bowlingTeam, "bowling")
        team_net = clamp_number(batting_team_strength - bowling_team_strength, -1.25, 1.25)
        if team_net:
            team_phase_mult = 1.0
            if format_key == "t20" and phase == "death":
                team_phase_mult = 1.10
            elif format_key == "test":
                team_phase_mult = 0.70
            tn = team_net * team_phase_mult
            weights["four"] *= clamp_number(1 + 0.105 * tn, 0.76, 1.24)
            weights["six"] *= clamp_number(1 + 0.135 * tn, 0.70, 1.32)
            weights["dot"] *= clamp_number(1 - 0.055 * tn, 0.86, 1.18)
            weights["one"] *= clamp_number(1 + 0.018 * tn, 0.94, 1.08)
            weights["two"] *= clamp_number(1 + 0.030 * tn, 0.92, 1.12)
            weights["wicket"] *= clamp_number(1 - 0.135 * tn, 0.70, 1.34)

        v25_team_cap_delta = {
            "boundary": 2.65 * team_net,
            "six": 0.82 * team_net,
            "wicket_cap": -0.88 * team_net,
            "wicket_floor": -0.66 * team_net,
        }

        v23_skill_cap_delta = {
            "boundary": (1.18 * positive_skill_pressure + 1.95 * weak_bowling_pressure - 1.05 * negative_skill_pressure - 1.62 * elite_bowler_pressure) * phase_attack_multiplier,
            "six": (0.34 * positive_skill_pressure + 0.78 * weak_bowling_pressure - 0.34 * negative_skill_pressure - 0.60 * elite_bowler_pressure) * phase_attack_multiplier,
            "wicket_cap": (0.76 * negative_skill_pressure + 1.18 * elite_bowler_pressure - 0.34 * positive_skill_pressure - 0.50 * weak_bowling_pressure) * (0.80 if format_key == "test" else 1.0),
            "wicket_floor": (0.44 * negative_skill_pressure + 0.78 * elite_bowler_pressure - 0.24 * positive_skill_pressure - 0.34 * weak_bowling_pressure) * (0.75 if format_key == "test" else 1.0),
        }

        bowler_role = bowler_role_for_contest
        part_time_leak = clamp_number(weak_bowler_edge, 0, 4.5)
        if part_time_leak > 0.15:
            weights["dot"] *= 1 - min(0.24, part_time_leak * 0.048)
            weights["one"] += part_time_leak * 1.55
            weights["two"] += part_time_leak * 0.88
            weights["four"] += part_time_leak * (0.38 if batter_role == "bowler" else 1.05)
            weights["six"] += part_time_leak * (0.35 if agg >= 8 else 0.18)
            weights["wicket"] *= 1 - min(0.40, part_time_leak * 0.082)

        late_batter_fatigue = max(0, batter_fatigue - 35) / 10
        extreme_batter_fatigue = max(0, batter_fatigue - 50) / 10
        late_bowler_fatigue = max(0, bowler_fatigue - 30) / 10
        weights["dot"] += late_batter_fatigue * 0.65 + extreme_batter_fatigue * 0.85
        weights["one"] += late_bowler_fatigue * 0.38
        weights["two"] += late_bowler_fatigue * 0.16 - late_batter_fatigue * 0.22
        weights["four"] += late_bowler_fatigue * 0.06 - late_batter_fatigue * 0.55 - extreme_batter_fatigue * 0.70
        weights["six"] += late_bowler_fatigue * 0.02 - late_batter_fatigue * 0.48 - extreme_batter_fatigue * 0.70
        weights["wicket"] += late_batter_fatigue * 0.24 + extreme_batter_fatigue * 0.34 - late_bowler_fatigue * 0.18

        innings_wickets = s.wickets or 0
        collapse_softener = 0.0
        if format_key == "t20":
            if innings_wickets >= 3 and over_now < 8: collapse_softener += 0.18
            if innings_wickets >= 5 and over_now < 13: collapse_softener += 0.28
            if innings_wickets >= 7 and over_now < 17: collapse_softener += 0.24
        elif format_key == "odi":
            if innings_wickets >= 4 and over_now < 25: collapse_softener += 0.16
            if innings_wickets >= 6 and over_now < 35: collapse_softener += 0.20
            if innings_wickets >= 8 and over_now < 45: collapse_softener += 0.16
        else:
            if innings_wickets >= 3 and over_now < 25: collapse_softener += 0.12
            if innings_wickets >= 5 and over_now < 55: collapse_softener += 0.16
            if innings_wickets >= 7 and over_now < 80: collapse_softener += 0.14
        if collapse_softener > 0:
            removed = max(0, weights["wicket"]) * clamp_number(collapse_softener, 0, 0.40 if format_key == "t20" else 0.32)
            weights["wicket"] -= removed
            weights["dot"] += removed * 0.58
            weights["one"] += removed * 0.32
            weights["two"] += removed * 0.10

        boundary_cap = (4.2 + agg * 0.55 + high_agg * 0.18) if format_key == "test" else (10.0 + agg * 0.95 + high_agg * 0.50) if format_key == "odi" else (11.5 + agg * 1.45 + high_agg * 1.05)
        if format_key == "t20" and over_now >= 16: boundary_cap += 2.5
        if format_key == "t20" and over_now >= 18: boundary_cap += 1.0
        if format_key == "odi" and phase == "powerplay": boundary_cap += 0.8
        if format_key == "odi" and phase == "setup": boundary_cap += 1.2
        if format_key == "odi" and phase == "death": boundary_cap += 4.0
        if format_key == "test" and phase == "oldBall": boundary_cap += 1.1
        if format_key == "test" and phase == "secondNewBall": boundary_cap += 0.3
        if batter_role == "bowler": boundary_cap -= 6.0
        if part_time_leak > 0.15: boundary_cap += clamp_number(1.5 + part_time_leak * 1.25 + positive_skill * 0.45, 1.5, 7.0)
        if batter_role == "allrounder": boundary_cap -= 2.0
        if innings_wickets >= 5: boundary_cap -= 1.4
        if innings_wickets >= 7: boundary_cap -= 2.0
        if innings_wickets >= 9: boundary_cap -= 1.6
        boundary_cap += playstyle_info.get("capDelta", {}).get("boundary", 0)
        boundary_cap += v23_skill_cap_delta["boundary"]
        boundary_cap += v25_team_cap_delta["boundary"]
        boundary_cap = clamp_number(boundary_cap, 10.0 if format_key == "t20" else 8.2 if format_key == "odi" else 3.2, 36.0 if format_key == "t20" else 29.0 if format_key == "odi" else 13.2)
        boundary_cap_info = self._cap_combined_chance(weights, ["four", "six"], boundary_cap, attack_index)

        six_cap = (0.15 + agg * 0.12 + high_agg * 0.05) if format_key == "test" else (0.80 + agg * 0.28 + high_agg * 0.18) if format_key == "odi" else (2.0 + agg * 0.55 + high_agg * 0.35)
        if format_key == "t20" and over_now >= 16: six_cap += 0.8
        if format_key == "t20" and over_now >= 18: six_cap += 0.4
        if format_key == "odi" and phase == "death": six_cap += 1.2
        if format_key == "odi" and phase == "setup": six_cap += 0.35
        if format_key == "test" and phase == "oldBall": six_cap += 0.20
        if batter_role == "bowler": six_cap -= 3.0
        if part_time_leak > 0.15: six_cap += clamp_number(0.25 + part_time_leak * 0.28, 0.25, 1.6)
        if batter_role == "allrounder": six_cap -= 0.8
        if innings_wickets >= 7: six_cap -= 0.8
        six_cap += playstyle_info.get("capDelta", {}).get("six", 0)
        six_cap += v23_skill_cap_delta["six"]
        six_cap += v25_team_cap_delta["six"]
        six_cap = clamp_number(six_cap, 0.9 if format_key == "t20" else 0.35 if format_key == "odi" else 0.12, 12.8 if format_key == "t20" else 7.4 if format_key == "odi" else 2.6)
        six_cap_info = self._cap_combined_chance(weights, ["six"], six_cap, attack_index)

        wicket_cap = (2.8 + attack_index * 0.9) if format_key == "test" else (4.0 + attack_index * 1.4) if format_key == "odi" else (4.3 + attack_index * 2.8)
        if batter_role == "bowler": wicket_cap += 0.9
        if bowler_role == "bowler": wicket_cap += 0.3
        if part_time_leak > 0.15: wicket_cap -= clamp_number(0.5 + part_time_leak * 0.22, 0.5, 1.8)
        if format_key == "t20" and phase == "death": wicket_cap += 0.5
        if format_key == "odi" and phase == "death": wicket_cap += 0.6
        if format_key == "test" and phase == "newBall": wicket_cap += 0.8
        if format_key == "test" and phase == "secondNewBall": wicket_cap += 0.6
        if format_key == "t20" and innings_wickets >= 3 and over_now < 8: wicket_cap -= 0.6
        if format_key == "t20" and innings_wickets >= 5 and over_now < 13: wicket_cap -= 0.9
        if format_key == "t20" and innings_wickets >= 7 and over_now < 17: wicket_cap -= 0.8
        wicket_cap += playstyle_info.get("capDelta", {}).get("wicket_cap", 0)
        wicket_cap += v23_skill_cap_delta["wicket_cap"]
        wicket_cap += v25_team_cap_delta["wicket_cap"]
        wicket_cap = clamp_number(wicket_cap, 2.2 if format_key == "t20" else 1.7 if format_key == "odi" else 1.2, 10.4 if format_key == "t20" else 7.5 if format_key == "odi" else 5.6)
        wicket_cap_info = self._cap_combined_chance(weights, ["wicket"], wicket_cap, attack_index)

        wicket_floor = (1.8 + attack_index * 2.8) if format_key == "t20" else (1.0 + attack_index * 1.5) if format_key == "odi" else (0.55 + attack_index * 0.85)
        if batter_role == "bowler": wicket_floor += 0.9
        if bowler_role == "bowler": wicket_floor += 0.25
        if format_key == "odi" and phase == "death": wicket_floor += 0.30
        if format_key == "test" and phase in {"newBall", "secondNewBall"}: wicket_floor += 0.25
        if part_time_leak > 0.15: wicket_floor -= clamp_number(0.4 + part_time_leak * 0.18, 0.4, 1.4)
        wicket_floor += max(0, batter_fatigue - 35) * 0.022
        wicket_floor += playstyle_info.get("capDelta", {}).get("wicket_floor", 0)
        wicket_floor += v23_skill_cap_delta["wicket_floor"]
        wicket_floor += v25_team_cap_delta["wicket_floor"]
        wicket_floor = clamp_number(wicket_floor, 0.20 if format_key == "test" else 0.40, 7.4 if format_key == "t20" else 5.8 if format_key == "odi" else 3.4)
        wicket_floor_info = self._raise_minimum_chance(weights, "wicket", wicket_floor, ["four", "six", "dot", "one"])

        for key in list(weights.keys()):
            weights[key] = max(0.10, round2(weights[key]))
        roll_data = self._roll_weighted_outcome_with_debug(weights)
        self.state.lastSkillContest = {
            "engineVersion": ENGINE_VERSION,
            "ballLabel": balls_to_delivery_label(self.state.balls + 1),
            "batter": get_player_name(striker_player),
            "bowler": get_player_name(bowler_player),
            "format": format_key,
            "phase": phase,
            "aggression": agg,
            "batterRoleGroup": get_role_group_for_skill(striker_player),
            "bowlerRoleGroup": bowler_role,
            "battingPlaystyle": playstyle_info.get("battingStyle"),
            "bowlingPlaystyle": playstyle_info.get("bowlingStyle"),
            "playstyleNotes": playstyle_info.get("notes", []),
            "partTimeLeak": round1(part_time_leak),
            "v23EliteBowlerPressure": round2(elite_bowler_pressure),
            "v23WeakBowlingPressure": round2(weak_bowling_pressure),
            "v23SkillCapDelta": {k: round2(v) for k, v in v23_skill_cap_delta.items()},
            "v25TeamNet": round2(team_net),
            "v25TeamCapDelta": {k: round2(v) for k, v in v25_team_cap_delta.items()},
            "batterScore": round1(batter_score),
            "bowlerScore": round1(bowler_score),
            "skillEdge": round1(skill_edge),
            "batterConfidence": round1(batter_confidence),
            "batterFatigue": round1(batter_fatigue),
            "bowlerFatigue": round1(bowler_fatigue),
            "bowlerStamina": round(stamina),
            "contactMix": {k: round1(v * 100) for k, v in contact_mix.items()},
            "boundaryCap": boundary_cap_info,
            "sixCap": six_cap_info,
            "wicketCap": wicket_cap_info,
            "wicketFloor": wicket_floor_info,
            "weights": weights,
            "chances": roll_data["entries"],
            "chosenOutcome": roll_data["chosenKey"],
            "outcome": roll_data["outcome"],
        }
        return roll_data["outcome"]

    def play_ball(self, aggression: int) -> Optional[Outcome]:
        s = self.state
        if s.completed:
            return None
        max_balls = s.maxOvers * 6
        if s.balls >= max_balls or s.wickets >= 10:
            s.completed = True
            return None
        striker_player = self.get_batter_by_key(s.strikerKey) or {}
        bowler_player = self.get_bowler_by_key(s.currentBowlerKey) or {}
        outcome = self.pick_outcome(aggression, striker_player, bowler_player)
        striker = self.ensure_batter_stat(s.strikerKey)
        bowler = self.ensure_bowler_stat(s.currentBowlerKey)

        s.balls += 1
        bowler.balls += 1
        self.drain_bowler_stamina(s.currentBowlerKey)
        striker.balls += 1
        s.partnershipBalls += 1

        self.update_batter_confidence_after_outcome(s.strikerKey, outcome)
        self.update_batter_fatigue_after_outcome(s.strikerKey, outcome, aggression, False)
        if isinstance(outcome, int) and outcome in [1, 2, 3]:
            self.update_batter_fatigue_after_outcome(s.nonStrikerKey, outcome, aggression, True)

        if outcome == "W":
            s.wickets += 1
            bowler.wickets += 1
            striker.out = True
            striker.howOut = f"c & b {bowler.name}"
            s.partnershipRuns = 0
            s.partnershipBalls = 0
            if s.wickets < 10 and s.nextBatterIndex < len(s.batting_xi):
                new_batter = s.batting_xi[s.nextBatterIndex]
                new_key = get_player_key(new_batter, f"batter_{s.nextBatterIndex}")
                s.battingStats[new_key] = self._create_batter_stat(new_batter)
                s.strikerKey = new_key
                s.nextBatterIndex += 1
            else:
                s.completed = True
        else:
            runs = int(outcome or 0)
            s.runs += runs
            s.partnershipRuns += runs
            striker.runs += runs
            bowler.runs += runs
            if runs == 4:
                striker.fours += 1
            if runs == 6:
                striker.sixes += 1
            if runs % 2 == 1:
                self.switch_strike()

        # Chase ends early.
        if s.target is not None and s.runs >= s.target:
            s.completed = True

        if s.balls % 6 == 0 and not s.completed:
            completed_bowler_key = s.currentBowlerKey
            completed_bowler = self.ensure_bowler_stat(completed_bowler_key)
            completed_bowler.lastOverBowled = s.balls // 6
            s.overHistory.append({"over": s.balls // 6, "bowlerKey": completed_bowler_key, "bowlerName": completed_bowler.name, "balls": completed_bowler.balls, "stamina": round(completed_bowler.stamina)})
            s.overHistory = s.overHistory[-30:]
            self.switch_strike()
            self.choose_next_bowler()

        if s.balls >= max_balls or s.wickets >= 10:
            s.completed = True
        return outcome

    def current_snapshot(self) -> InningsSnapshot:
        s = self.state
        return InningsSnapshot(
            inningsNumber=s.inningsNumber,
            battingTeam=s.battingTeam,
            bowlingTeam=s.bowlingTeam,
            battingSide=s.battingSide,
            bowlingSide=s.bowlingSide,
            runs=s.runs,
            wickets=s.wickets,
            balls=s.balls,
            overs=balls_to_overs(s.balls),
            runRate=get_run_rate(s.runs, s.balls),
        )

    def _chance_from_last_contest(self, contest: Dict[str, Any], outcome_key: str) -> float:
        for item in contest.get("chances", []) or []:
            if item.get("outcome") == outcome_key:
                return js_number(item.get("chance"), 0.0)
        return 0.0

    def _best_contact_from_last_contest(self, contest: Dict[str, Any]) -> Tuple[str, float]:
        mix = contest.get("contactMix") if isinstance(contest.get("contactMix"), dict) else {}
        if not mix:
            return "controlled", 0.0
        best_key = max(mix, key=lambda key: js_number(mix.get(key), 0.0))
        return best_key, js_number(mix.get(best_key), 0.0)

    def format_ball_by_ball_line(self, outcome: Outcome) -> str:
        c = self.state.lastSkillContest or {}
        four_pct = self._chance_from_last_contest(c, "four")
        six_pct = self._chance_from_last_contest(c, "six")
        wicket_pct = self._chance_from_last_contest(c, "wicket")
        outcome_key = c.get("chosenOutcome") or ("wicket" if outcome == "W" else "four" if outcome == 4 else "six" if outcome == 6 else "dot" if outcome == 0 else "one" if outcome == 1 else "two" if outcome == 2 else "three")
        outcome_pct = self._chance_from_last_contest(c, str(outcome_key))
        contact_name, contact_pct = self._best_contact_from_last_contest(c)
        batter_name = c.get("batter", "Batter")
        bowler_name = c.get("bowler", "Bowler")
        batter_score = js_number(c.get("batterScore"), 0.0)
        bowler_score = js_number(c.get("bowlerScore"), 0.0)
        edge = js_number(c.get("skillEdge"), 0.0)
        edge_text = f"{edge:+.1f}"
        return (
            f"Ball {c.get('ballLabel')} | "
            f"{batter_name} {batter_score:.1f} vs {bowler_name} {bowler_score:.1f} | "
            f"Edge {edge_text} | "
            f"Outcome {outcome} ({outcome_pct:.1f}%) | "
            f"4: {four_pct:.1f}% | 6: {six_pct:.1f}% | W: {wicket_pct:.1f}% | "
            f"Contact: {contact_name} {contact_pct:.1f}% | "
            f"Score {self.state.runs}/{self.state.wickets}"
        )

    def simulate_current_innings(self, aggression: int, max_balls: Optional[int] = None, verbose: bool = False) -> InningsSnapshot:
        limit = max_balls if max_balls is not None else self.state.maxOvers * 6
        while not self.state.completed and self.state.balls < limit:
            outcome = self.play_ball(aggression)
            if verbose and outcome is not None:
                print(self.format_ball_by_ball_line(outcome))
        self.state.completed = True
        return self.current_snapshot()

    def _next_innings_sides(self, next_innings_number: int) -> Tuple[List[Player], List[Player], str, str, str, str]:
        cards = getattr(self, "_scorecards_for_match", None) or self.state.inningsScorecards
        first = cards[0]
        first_batting_xi = self.initial["batting_xi"]
        second_batting_xi = self.initial["bowling_xi"]
        if get_format_key(self.state.format) != "test":
            return second_batting_xi, first_batting_xi, first.bowlingTeam, first.battingTeam, first.bowlingSide, first.battingSide
        if next_innings_number % 2 == 1:
            return first_batting_xi, second_batting_xi, first.battingTeam, first.bowlingTeam, first.battingSide, first.bowlingSide
        return second_batting_xi, first_batting_xi, first.bowlingTeam, first.battingTeam, first.bowlingSide, first.battingSide

    def _start_next_innings(self, next_innings_number: int, target: Optional[int]) -> None:
        batting_xi, bowling_xi, batting_team, bowling_team, batting_side, bowling_side = self._next_innings_sides(next_innings_number)
        self.state = self._create_innings_state(
            batting_xi=copy.deepcopy(batting_xi),
            bowling_xi=copy.deepcopy(bowling_xi),
            format_value=self.initial["format"],
            batting_team=batting_team,
            bowling_team=bowling_team,
            batting_side=batting_side,
            bowling_side=bowling_side,
            innings_number=next_innings_number,
            target=target,
            use_computer_pattern=self.initial["use_computer_pattern"],
        )
        self.state.inningsScorecards = list(self._scorecards_for_match)
        self.state.firstInnings = self._scorecards_for_match[0] if self._scorecards_for_match else None
        self.state.secondInnings = self._scorecards_for_match[1] if len(self._scorecards_for_match) > 1 else None

    def simulate_match(self, aggression: int) -> Dict[str, Any]:
        self.reset_single_innings()
        self._scorecards_for_match: List[InningsSnapshot] = []
        fmt = get_format_key(self.state.format)
        if fmt != "test":
            first = self.simulate_current_innings(aggression)
            self._scorecards_for_match.append(first)
            self._start_next_innings(2, first.runs + 1)
            second = self.simulate_current_innings(aggression)
            self._scorecards_for_match.append(second)
            if second.runs >= first.runs + 1:
                winner = second.battingTeam
                margin = f"{max(0, 10 - second.wickets)} wickets"
            elif second.runs == first.runs:
                winner = None
                margin = "Match tied"
            else:
                winner = first.battingTeam
                margin = f"{max(1, first.runs - second.runs)} runs"
            return {"format": fmt, "result": f"{winner + ' won by ' + margin if winner else margin}", "scorecards": [s.__dict__ for s in self._scorecards_for_match]}

        # Simple V21-style 4 innings Test flow.
        first = self.simulate_current_innings(aggression)
        self._scorecards_for_match.append(first)
        self._start_next_innings(2, None)
        second = self.simulate_current_innings(aggression)
        self._scorecards_for_match.append(second)
        self._start_next_innings(3, None)
        third = self.simulate_current_innings(aggression)
        self._scorecards_for_match.append(third)
        first_side = first.battingSide
        second_side = first.bowlingSide
        first_total = sum(s.runs for s in self._scorecards_for_match if s.battingSide == first_side)
        second_total = sum(s.runs for s in self._scorecards_for_match if s.battingSide == second_side)
        if first_total <= second_total:
            margin = f"an innings and {max(1, second_total - first_total + 1)} runs"
            return {"format": fmt, "result": f"{second.battingTeam} won by {margin}", "scorecards": [s.__dict__ for s in self._scorecards_for_match]}
        target = max(1, first_total - second_total + 1)
        self._start_next_innings(4, target)
        fourth = self.simulate_current_innings(aggression)
        self._scorecards_for_match.append(fourth)
        if fourth.runs >= target:
            result = f"{fourth.battingTeam} won by {max(0, 10 - fourth.wickets)} wickets"
        elif fourth.runs == target - 1:
            result = "Match tied"
        else:
            result = f"{third.battingTeam} won by {target - 1 - fourth.runs} runs"
        return {"format": fmt, "result": result, "scorecards": [s.__dict__ for s in self._scorecards_for_match]}


def get_low_score_threshold(format_key: str) -> int:
    if format_key == "test":
        return 170
    if format_key == "odi":
        return 190
    return 110


def summarize_scores(results: List[Dict[str, Any]], format_key: str, aggression: int) -> Dict[str, Any]:
    scores = [r["runs"] for r in results]
    sorted_scores = sorted(results, key=lambda x: x["runs"])
    low_threshold = get_low_score_threshold(format_key)
    low_scores = [r for r in results if r["runs"] < low_threshold]
    collapses = [r for r in results if r["collapse"]]
    all_outs = [r for r in results if r["allOut"]]
    def percentile(values: List[int], p: float) -> int:
        if not values:
            return 0
        idx = int(math.floor((len(values) - 1) * p))
        return sorted(values)[idx]
    return {
        "engine": ENGINE_VERSION,
        "aggression": aggression,
        "format": format_key,
        "simulations": len(results),
        "averageScore": round1(sum(scores) / len(scores)) if scores else 0,
        "medianScore": int(statistics.median(scores)) if scores else 0,
        "p10Score": percentile(scores, 0.10),
        "p90Score": percentile(scores, 0.90),
        "lowestScore": min(scores) if scores else 0,
        "highestScore": max(scores) if scores else 0,
        "allOuts": len(all_outs),
        "allOutRate": round1(len(all_outs) / len(results) * 100) if results else 0,
        "lowScores": len(low_scores),
        "lowScoreRate": round1(len(low_scores) / len(results) * 100) if results else 0,
        "collapses": len(collapses),
        "collapseRate": round1(len(collapses) / len(results) * 100) if results else 0,
        "lowestTen": sorted_scores[:10],
        "highestFive": sorted_scores[-5:][::-1],
    }


def run_innings_sims(batting_xi: List[Player], bowling_xi: List[Player], fmt: str, aggression: int, sims: int, seed: Optional[int], batting_team: str, bowling_team: str) -> Dict[str, Any]:
    format_key = get_format_key(fmt)
    results = []
    for i in range(sims):
        engine = V21Engine(batting_xi, bowling_xi, fmt, batting_team, bowling_team, seed=None if seed is None else seed + i)
        snap = engine.simulate_current_innings(aggression)
        low = snap.runs < get_low_score_threshold(format_key)
        collapse = (format_key == "t20" and snap.runs < 115 and snap.wickets >= 8) or (format_key == "odi" and snap.runs < 190 and snap.wickets >= 8) or (format_key == "test" and snap.runs < 170 and snap.wickets >= 8)
        results.append({
            "sim": i + 1,
            "runs": snap.runs,
            "wickets": snap.wickets,
            "balls": snap.balls,
            "overs": snap.overs,
            "allOut": snap.wickets >= 10,
            "lowScore": low,
            "collapse": collapse,
            "format": format_key,
        })
    return summarize_scores(results, format_key, aggression)


def player(name: str, role: str, bat: float, bowl: float, stamina: float = 14, style: str = "pace") -> Player:
    # Compact 20-scale player builder. Real JSON from your app can be loaded with --json.
    bowling_type = "spin" if style == "spin" else "pace"
    return {
        "id": name.lower().replace(" ", "_"),
        "name": name,
        "role": role,
        "bowlingType": bowling_type if bowl > 0 else "none",
        "bowlingStyle": "Right-arm offbreak" if style == "spin" else "Right-arm fast-medium",
        "attributes": {
            "overall": {"batting_overall": bat, "bowling_overall": bowl},
            "batting": {
                "technique": bat, "timing": bat, "placement": max(1, bat - 0.5), "footwork": bat,
                "range360": bat, "defensiveShots": bat, "neutralShots": bat, "attackingShots": bat,
                "vsPace": bat, "vsSpin": bat, "creativity": bat,
            },
            "bowling": {
                "accuracy": bowl, "bowlingSpeed": bowl if style != "spin" else max(1, bowl - 4), "swing": bowl if style != "spin" else max(1, bowl - 5),
                "turn": bowl if style == "spin" else max(1, bowl - 5), "flight": bowl if style == "spin" else max(1, bowl - 5),
                "variations": bowl, "intelligence": bowl, "defensiveBowling": bowl, "neutralBowling": bowl, "attackingBowling": bowl,
            },
            "mental": {"concentration": bat, "judgement": bat, "aggression": bat, "temperament": max(bat, bowl), "leadership": max(bat, bowl) - 1},
            "physical": {"speed": 13, "strength": 13, "stamina": stamina, "fitness": stamina, "endurance": stamina},
        },
    }


def demo_aus_ire() -> Tuple[List[Player], List[Player], str, str]:
    aus = [
        player("Travis Head", "batter", 17.0, 2.0, 15),
        player("David Warner", "batter", 16.3, 1.0, 14),
        player("Marnus Labuschagne", "batter", 16.0, 3.0, 15),
        player("Glenn Maxwell", "all-rounder", 15.4, 13.2, 13, "spin"),
        player("Tim David", "batter", 15.6, 1.0, 13),
        player("Alex Carey", "wicketkeeper", 14.8, 0.0, 14),
        player("Mitchell Marsh", "all-rounder", 15.1, 12.5, 13),
        player("Pat Cummins", "bowler", 10.8, 16.4, 16),
        player("Mitchell Starc", "bowler", 10.4, 16.2, 15),
        player("Adam Zampa", "bowler", 7.0, 15.0, 14, "spin"),
        player("Josh Hazlewood", "bowler", 6.8, 16.8, 15),
    ]
    ire = [
        player("Paul Stirling", "all-rounder", 14.0, 9.0, 13, "spin"),
        player("Andrew Balbirnie", "batter", 13.5, 0.0, 13),
        player("Harry Tector", "batter", 14.2, 1.0, 13),
        player("Lorcan Tucker", "wicketkeeper", 13.2, 0.0, 13),
        player("Curtis Campher", "all-rounder", 12.8, 12.2, 13),
        player("George Dockrell", "all-rounder", 12.6, 12.8, 13, "spin"),
        player("Mark Adair", "bowler", 9.0, 13.8, 14),
        player("Barry McCarthy", "bowler", 8.0, 13.2, 13),
        player("Josh Little", "bowler", 7.2, 14.8, 14),
        player("Craig Young", "bowler", 7.0, 13.4, 13),
        player("Ben White", "bowler", 6.5, 12.8, 13, "spin"),
    ]
    return aus, ire, "Australia", "Ireland"


def load_match_json(path: Path, batting_side: str = "user", bowling_side: str = "computer") -> Tuple[List[Player], List[Player], str, str]:
    data = json.loads(path.read_text(encoding="utf-8"))
    user_xi = data.get("selectedUserXI") or data.get("userXI") or data.get("userSquad") or []
    comp_xi = data.get("selectedComputerXI") or data.get("computerXI") or data.get("computerSquad") or []
    teams = data.get("teams") if isinstance(data.get("teams"), dict) else {}
    user_team = data.get("userTeam") or teams.get("userTeam") or teams.get("home") or "User Team"
    comp_team = data.get("computerTeam") or teams.get("computerTeam") or teams.get("away") or "Computer Team"
    side_to_xi = {"user": user_xi, "computer": comp_xi}
    side_to_team = {"user": user_team, "computer": comp_team}
    batting_xi = side_to_xi.get(batting_side, user_xi)
    bowling_xi = side_to_xi.get(bowling_side, comp_xi)
    if not batting_xi or not bowling_xi:
        raise ValueError("Could not find selected XI / squads in JSON. Expected selectedUserXI/userSquad and selectedComputerXI/computerSquad.")
    return batting_xi, bowling_xi, side_to_team.get(batting_side, batting_side), side_to_team.get(bowling_side, bowling_side)


def main() -> None:
    parser = argparse.ArgumentParser(description="V21 cricket engine Python stress tester")
    parser.add_argument("--format", default="t20", choices=["t20", "odi", "test"], help="Match format to test")
    parser.add_argument("--aggression", type=int, default=6, help="Aggression 1-10")
    parser.add_argument("--sims", type=int, default=200, help="Number of innings simulations")
    parser.add_argument("--seed", type=int, default=7, help="Base random seed")
    parser.add_argument("--json", type=str, default="", help="Optional currentTourMatch JSON path")
    parser.add_argument("--batting-side", default="user", choices=["user", "computer"], help="When using --json, which side bats")
    parser.add_argument("--bowling-side", default="computer", choices=["user", "computer"], help="When using --json, which side bowls")
    parser.add_argument("--full-match", action="store_true", help="Simulate one complete match instead of stress-testing innings")
    parser.add_argument("--verbose", action="store_true", help="Print ball-by-ball for one innings")
    parser.add_argument("--max-balls", type=int, default=0, help="When using --verbose, stop after this many balls. 0 = full innings")
    args = parser.parse_args()

    if args.json:
        batting_xi, bowling_xi, batting_team, bowling_team = load_match_json(Path(args.json), args.batting_side, args.bowling_side)
    else:
        batting_xi, bowling_xi, batting_team, bowling_team = demo_aus_ire()

    if args.full_match:
        engine = V21Engine(batting_xi, bowling_xi, args.format, batting_team, bowling_team, seed=args.seed)
        result = engine.simulate_match(args.aggression)
        print(json.dumps(result, indent=2))
        return

    if args.verbose:
        engine = V21Engine(batting_xi, bowling_xi, args.format, batting_team, bowling_team, seed=args.seed)
        snap = engine.simulate_current_innings(args.aggression, max_balls=args.max_balls or None, verbose=True)
        print(json.dumps(snap.__dict__, indent=2))
        return

    summary = run_innings_sims(batting_xi, bowling_xi, args.format, args.aggression, args.sims, args.seed, batting_team, bowling_team)
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
