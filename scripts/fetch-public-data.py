#!/usr/bin/env python3
"""Build the fixed, traceable historical sample. Network is opt-in via --refresh.

Default: reproduce snapshot.json solely from the checked-in raw responses.
--refresh: fetch public Eastmoney financials, historical valuations and daily bars.
No credentials, paid API, inferred values or synthesized market data are used.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import math
from pathlib import Path
import statistics
import time
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
CODES = ["600519", "000858", "000333", "000651", "600036", "601318",
         "600900", "002594", "300750", "600276", "601012", "300033"]
REPORT_DATE = "2024-12-31"
MARKET_DATE = "2025-04-30"
BASE = "https://datacenter-web.eastmoney.com/api/data/v1/get"


def query_url(report, date_field, date):
    codes = ",".join(f'"{code}"' for code in CODES)
    params = {"reportName": report, "columns": "ALL",
              "filter": f"({date_field}='{date}')(SECURITY_CODE in ({codes}))",
              "pageNumber": "1", "pageSize": "50", "source": "WEB", "client": "WEB"}
    return BASE + "?" + urllib.parse.urlencode(params)


def prices_url(code):
    params = {"secid": f"{1 if code.startswith('6') else 0}.{code}",
              "klt": "101", "fqt": "2", "beg": "20250101", "end": "20250430",
              "fields1": "f1,f2,f3,f4,f5,f6",
              "fields2": "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61"}
    return "https://push2his.eastmoney.com/api/qt/stock/kline/get?" + urllib.parse.urlencode(params)


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def fetch(url, path):
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=35) as response:
        raw = response.read()
    obj = json.loads(raw)
    if obj.get("success") is False or obj.get("rc", 0) != 0:
        raise ValueError(f"Upstream failure for {path.name}: {obj.get('message')}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(raw + (b"" if raw.endswith(b"\n") else b"\n"))
    return {"file": str(path.relative_to(ROOT)), "url": url,
            "retrievedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


def number(value):
    if value is None or value == "":
        return None
    parsed = float(value)
    return parsed if math.isfinite(parsed) else None


def annualized_volatility(bars):
    # fields2 order: date, open, close, high, low, volume, amount, ...
    parsed = sorted((bar.split(",")[0], number(bar.split(",")[2])) for bar in bars)
    parsed = [(date, close) for date, close in parsed if date <= MARKET_DATE]
    if len(parsed) < 61:
        return None, {"observations": max(0, len(parsed) - 1), "reason": "少于 61 个收盘价"}
    window = parsed[-61:]
    if len({date for date, _ in window}) != 61 or any(close is None or close <= 0 for _, close in window):
        return None, {"reason": "价格缺失、非正数或日期重复"}
    if window[-1][0] != MARKET_DATE:
        return None, {"reason": "末个交易日与快照日期不一致"}
    returns = [math.log(window[i][1] / window[i - 1][1]) for i in range(1, len(window))]
    result = statistics.stdev(returns) * math.sqrt(252) * 100
    return result, {"observations": len(returns), "prices": len(window),
                    "windowStart": window[0][0], "windowEnd": window[-1][0],
                    "adjustment": "后复权（fqt=2）", "ddof": 1, "annualizationDays": 252}


def build():
    financials = read_json(RAW / "financials-2024.json")["result"]["data"]
    valuations = read_json(RAW / "valuations-2025-04-30.json")["result"]["data"]
    manifest = read_json(RAW / "manifest.json")
    for entry in manifest["responses"]:
        actual_hash = hashlib.sha256((ROOT / entry["file"]).read_bytes()).hexdigest()
        assert actual_hash == entry["sha256"], f"Raw evidence changed: {entry['file']}"
    financial_by_code = {x["SECURITY_CODE"]: x for x in financials}
    valuation_by_code = {x["SECURITY_CODE"]: x for x in valuations}
    assert set(CODES) == set(financial_by_code), "Financial universe changed or response incomplete"
    assert set(CODES) == set(valuation_by_code), "Valuation universe changed or response incomplete"
    stocks = []
    for code in CODES:
        f = financial_by_code[code]
        v = valuation_by_code[code]
        assert f["REPORTDATE"][:10] == REPORT_DATE
        assert v["TRADE_DATE"][:10] == MARKET_DATE
        prices = read_json(RAW / f"prices-{code}.json")["data"]
        assert prices["code"] == code
        volatility, computation = annualized_volatility(prices.get("klines", []))
        common = {"source": "东方财富 Choice · 年报业绩报表",
                  "url": f"https://data.eastmoney.com/bbsj/{code}.html",
                  "apiUrl": query_url("RPT_LICO_FN_CPD", "REPORTDATE", REPORT_DATE),
                  "asOf": REPORT_DATE, "period": "2024 年年报", "unit": "%",
                  "publishedAt": f["NOTICE_DATE"][:10], "sourceUpdatedAt": f["UPDATE_DATE"][:10],
                  "rawFile": "data/raw/financials-2024.json"}
        stocks.append({
            "code": f["SECUCODE"], "name": f["SECURITY_NAME_ABBR"], "industry": f["PUBLISHNAME"],
            "metrics": {"revenueGrowth": number(f.get("YSTZ")), "profitGrowth": number(f.get("SJLTZ")),
                        "roe": number(f.get("WEIGHTAVG_ROE")), "peTtm": number(v.get("PE_TTM")),
                        "volatility": volatility},
            "provenance": {
                "revenueGrowth": {**common, "field": "YSTZ", "note": "营业总收入同比；不是仅主营业务收入。当前可得修订版本。"},
                "profitGrowth": {**common, "field": "SJLTZ", "note": "归属于母公司股东的净利润同比；不是扣非净利润同比。当前可得修订版本。"},
                "roe": {**common, "field": "WEIGHTAVG_ROE", "note": "加权平均净资产收益率；不是扣非 ROE。当前可得修订版本。"},
                "peTtm": {"source": "东方财富 Choice · 历史估值", "url": f"https://data.eastmoney.com/gzfx/detail/{code}.html",
                          "apiUrl": query_url("RPT_VALUEANALYSIS_DET", "TRADE_DATE", MARKET_DATE),
                          "asOf": MARKET_DATE, "period": "2025-04-30 历史交易日 / PE TTM", "unit": "倍",
                          "field": "PE_TTM", "rawFile": "data/raw/valuations-2025-04-30.json",
                          "note": "直接取数据源历史 PE_TTM，未用年报 EPS 自行替代；非正值不作低估值判断。历史序列可能被源站回填修订。"},
                "volatility": {"source": "东方财富历史日 K · 本地计算", "url": f"https://quote.eastmoney.com/{'sh' if code.startswith('6') else 'sz'}{code}.html",
                               "apiUrl": prices_url(code), "asOf": MARKET_DATE,
                               "period": f"{computation.get('windowStart', '')} 至 {MARKET_DATE}，60 个日收益率", "unit": "%（年化）",
                               "rawFile": f"data/raw/prices-{code}.json", "computation": computation,
                               "note": "后复权收盘价计算 ln(Pt/Pt-1)，60 个日对数收益率的样本标准差（ddof=1）×√252×100；反映历史波动，不预测未来。"}
            }
        })
    snapshot = {
        "title": "2024 年报 × 2025-04-30 行情", "asOf": MARKET_DATE, "mode": "historical",
        "description": "12 家固定 A 股研究样本。财务为 2024 年报，PE 与 60 日年化波动率对应 2025-04-30。源站历史记录包含后续回填修订，展示的是当前可得的历史数据，不代表当时已知信息集，不用于时点回测，也不是当前市场筛选。",
        "retrievedAt": max(item["retrievedAt"] for item in manifest["responses"]),
        "financialPeriod": REPORT_DATE, "marketDate": MARKET_DATE,
        "universeType": "fixed-research-sample", "isPointInTime": False,
        "metricLabels": {"revenueGrowth": "营业总收入同比", "profitGrowth": "归母净利润同比", "peTtm": "市盈率 PE（TTM）", "roe": "加权 ROE", "volatility": "60 日年化波动率"},
        "stocks": stocks
    }
    write_json(ROOT / "data" / "snapshot.json", snapshot)
    print(f"Built {len(stocks)} sourced historical companies → data/snapshot.json")
    for stock in stocks:
        print(stock["code"], stock["name"], {k: round(v, 4) if v is not None else None for k, v in stock["metrics"].items()})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true", help="Replace raw responses from the public network, then build")
    args = parser.parse_args()
    if args.refresh:
        tasks = [(query_url("RPT_LICO_FN_CPD", "REPORTDATE", REPORT_DATE), RAW / "financials-2024.json"),
                 (query_url("RPT_VALUEANALYSIS_DET", "TRADE_DATE", MARKET_DATE), RAW / "valuations-2025-04-30.json")]
        tasks += [(prices_url(code), RAW / f"prices-{code}.json") for code in CODES]
        entries = []
        for url, path in tasks:
            entries.append(fetch(url, path))
            time.sleep(0.3)
        write_json(RAW / "manifest.json", {"provider": "东方财富公开数据接口", "responses": entries})
    build()


if __name__ == "__main__":
    main()
