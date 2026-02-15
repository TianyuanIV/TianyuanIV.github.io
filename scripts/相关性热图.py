from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from matplotlib.colors import Normalize, PowerNorm


class SymPowerNorm(Normalize):
    def __init__(self, gamma: float = 1.0, vmin: float | None = None, vmax: float | None = None, clip: bool = False):
        super().__init__(vmin=vmin, vmax=vmax, clip=clip)
        self.gamma = gamma

    def __call__(self, value, clip=None):
        if clip is None:
            clip = self.clip
        result, is_scalar = self.process_value(value)
        self.autoscale_None(result)
        vmin, vmax = self.vmin, self.vmax
        vabs = max(abs(vmin), abs(vmax))
        if vabs == 0:
            res = np.zeros_like(result)
        else:
            res = np.clip(result, -vabs, vabs) / vabs
            res = np.sign(res) * (np.abs(res) ** self.gamma)
            res = (res + 1.0) / 2.0
        if is_scalar:
            res = res[0]
        return res

    def inverse(self, value):
        vmin, vmax = self.vmin, self.vmax
        vabs = max(abs(vmin), abs(vmax))
        if vabs == 0:
            return np.zeros_like(value)
        val = np.asarray(value)
        x = val * 2.0 - 1.0
        x = np.sign(x) * (np.abs(x) ** (1.0 / self.gamma))
        return x * vabs


def read_table(path: Path) -> pd.DataFrame:
    suffix = path.suffix.lower()
    if suffix in {".xlsx", ".xlsm", ".xlsb"}:
        try:
            return pd.read_excel(path, engine="openpyxl")
        except Exception:
            pass
    if suffix == ".xls":
        try:
            return pd.read_excel(path, engine="xlrd")
        except Exception:
            pass

    # Fallback to delimited text
    with path.open("rb") as f:
        head = f.read(4096)
    try:
        text_head = head.decode("utf-8", errors="ignore")
    except Exception:
        text_head = ""
    sep = "\t" if "\t" in text_head else ","
    df = pd.read_csv(path, sep=sep)
    if df.shape[1] == 1 and sep == ",":
        df = pd.read_csv(path, sep="\t")
    return df


def read_excel_sheet(path: Path, sheet_name: str) -> pd.DataFrame:
    suffix = path.suffix.lower()
    if suffix not in {".xlsx", ".xlsm", ".xlsb", ".xls"}:
        raise ValueError(f"Not an excel file: {path}")
    if suffix == ".xls":
        try:
            return pd.read_excel(path, sheet_name=sheet_name, engine="xlrd")
        except Exception:
            return pd.read_excel(path, sheet_name=sheet_name)
    try:
        return pd.read_excel(path, sheet_name=sheet_name, engine="openpyxl")
    except Exception:
        return pd.read_excel(path, sheet_name=sheet_name)


def align_by_gene(df1: pd.DataFrame, df2: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    g1 = df1.iloc[:, 0].astype(str)
    g2 = df2.iloc[:, 0].astype(str)
    df1 = df1.copy()
    df2 = df2.copy()
    df1.index = g1
    df2.index = g2

    common = df1.index[df1.index.isin(df2.index)]
    df1 = df1.loc[common]
    df2 = df2.loc[common]
    return df1, df2


def extract_expression(df: pd.DataFrame) -> pd.DataFrame:
    expr = df.iloc[:, 1:].apply(pd.to_numeric, errors="coerce")
    expr = expr.dropna(axis=1, how="all")
    return expr


def group_label(col: str) -> str:
    base = col.split(":", 1)[0]
    if "_" in base:
        left, right = base.rsplit("_", 1)
        if right.isdigit():
            return left
    if "-" in base:
        return base.rsplit("-", 1)[-1]
    return base


def average_by_group(expr: pd.DataFrame) -> pd.DataFrame:
    groups = {}
    order = []
    for col in expr.columns:
        grp = group_label(str(col))
        if grp not in groups:
            groups[grp] = []
            order.append(grp)
        groups[grp].append(col)

    out = pd.DataFrame(index=expr.index)
    for grp in order:
        out[grp] = expr[groups[grp]].mean(axis=1)
    return out


def auto_gamma(values: np.ndarray) -> float:
    finite = values[np.isfinite(values)]
    if finite.size == 0:
        return 1.0
    span = float(finite.max() - finite.min())
    if span < 0.15:
        return 0.45
    if span < 0.30:
        return 0.60
    if span < 0.50:
        return 0.80
    return 1.0


def apply_r_mode(mat: pd.DataFrame, r_mode: int) -> pd.DataFrame:
    if r_mode == 1:
        return mat.where(mat > 0)
    if r_mode == 2:
        return mat.where(mat < 0)
    return mat


def plot_heatmap(mat: pd.DataFrame, out_path: Path, title: str, r_mode: int) -> None:
    values = mat.values.astype(float)
    gamma = auto_gamma(values)

    if r_mode == 0:
        cmap = "coolwarm"
        if gamma != 1.0:
            norm = SymPowerNorm(gamma=gamma, vmin=-1, vmax=1)
        else:
            norm = Normalize(vmin=-1, vmax=1)
        cbar_label = "Pearson r (-1 to 1)"
    elif r_mode == 1:
        cmap = "magma"
        norm = PowerNorm(gamma=gamma, vmin=0, vmax=1)
        cbar_label = "Pearson r (0 to 1)"
    else:
        cmap = "magma_r"
        norm = PowerNorm(gamma=gamma, vmin=-1, vmax=0)
        cbar_label = "Pearson r (-1 to 0)"

    nrows, ncols = mat.shape
    annotate = nrows * ncols <= 2500

    plt.figure(figsize=(max(6, 0.35 * ncols + 4), max(5, 0.35 * nrows + 3)))
    cmap_obj = plt.get_cmap(cmap)
    plt.imshow(values, aspect="auto", cmap=cmap_obj, norm=norm)
    plt.colorbar(label=cbar_label)
    plt.yticks(ticks=np.arange(nrows), labels=mat.index.tolist(), fontsize=8)
    plt.xticks(ticks=np.arange(ncols), labels=mat.columns.tolist(), rotation=90, fontsize=8)
    plt.title(title)

    if annotate:
        for i in range(nrows):
            for j in range(ncols):
                val = values[i, j]
                if np.isnan(val):
                    text = "nan"
                    color = "black"
                else:
                    text = f"{val:.2f}"
                    rgba = cmap_obj(norm(val))
                    luminance = 0.2126 * rgba[0] + 0.7152 * rgba[1] + 0.0722 * rgba[2]
                    color = "white" if luminance < 0.5 else "black"
                plt.text(j, i, text, ha="center", va="center", fontsize=6, color=color)

    plt.tight_layout()
    plt.savefig(out_path, dpi=200)
    plt.close()


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Compute correlation matrix and plot heatmap for one or two expression tables."
    )
    parser.add_argument("-i", "--input", required=True, help="Input file (first column gene IDs)")
    parser.add_argument("-j", "--input2", help="Second input file (optional)")
    parser.add_argument("--sheet-a", help="Sheet name for first table when using one xlsx")
    parser.add_argument("--sheet-b", help="Sheet name for second table when using one xlsx")
    parser.add_argument("-r", "--r-mode", type=int, default=0, choices=[0, 1, 2],
                        help="0: -1~1, 1: >0 only, 2: <0 only")
    parser.add_argument("-avg", "--avg", action="store_true",
                        help="Average replicate columns into single cell columns")
    parser.add_argument("-o", "--out-prefix", help="Output prefix (optional)")

    args = parser.parse_args()

    input1 = Path(args.input)
    if not input1.exists():
        raise SystemExit(f"Input not found: {input1}")

    input2 = Path(args.input2) if args.input2 else None
    if input2 and not input2.exists():
        raise SystemExit(f"Input2 not found: {input2}")

    # Preferred mode: one xlsx, two sheets
    excel_suffix = input1.suffix.lower() in {".xlsx", ".xlsm", ".xlsb", ".xls"}
    if input2 is None and excel_suffix:
        excel = pd.ExcelFile(input1)
        if len(excel.sheet_names) >= 2:
            sheet_a = args.sheet_a or excel.sheet_names[0]
            sheet_b = args.sheet_b or excel.sheet_names[1]
            if sheet_a not in excel.sheet_names:
                raise SystemExit(f"Sheet not found: {sheet_a}")
            if sheet_b not in excel.sheet_names:
                raise SystemExit(f"Sheet not found: {sheet_b}")

            df1 = read_excel_sheet(input1, sheet_a)
            df2 = read_excel_sheet(input1, sheet_b)
            df1, df2 = align_by_gene(df1, df2)
            expr1 = extract_expression(df1)
            expr2 = extract_expression(df2)
            if args.avg:
                expr1 = average_by_group(expr1)
                expr2 = average_by_group(expr2)

            combined = pd.concat([expr1, expr2], axis=1)
            corr_all = combined.corr(method="pearson")

            cols1 = expr1.columns.tolist()
            cols2 = expr2.columns.tolist()
            corr = corr_all.loc[cols1, cols2]
            corr = apply_r_mode(corr, args.r_mode)

            safe_a = str(sheet_a).replace(" ", "_")
            safe_b = str(sheet_b).replace(" ", "_")
            prefix = args.out_prefix or f"{input1.stem}_{safe_a}_vs_{safe_b}"
            if args.avg and args.out_prefix is None:
                prefix = f"{prefix}_avg"
            out_matrix = Path(f"{prefix}_corr_matrix.xlsx")
            out_heatmap = Path(f"{prefix}_corr_heatmap.png")

            corr.to_excel(out_matrix)
            title = f"{sheet_a} vs {sheet_b} Correlation Heatmap"
            if args.avg:
                title = f"{sheet_a} vs {sheet_b} (avg) Correlation Heatmap"
            plot_heatmap(corr, out_heatmap, title, args.r_mode)

            print(f"Saved {out_matrix}")
            print(f"Saved {out_heatmap}")
            return 0

    df1 = read_table(input1)
    if input2 is None:
        expr1 = extract_expression(df1)
        if args.avg:
            expr1 = average_by_group(expr1)
        corr = expr1.corr(method="pearson")
        corr = apply_r_mode(corr, args.r_mode)

        stem = input1.stem
        prefix = args.out_prefix or stem
        if args.avg and args.out_prefix is None:
            prefix = f"{prefix}_avg"
        out_matrix = Path(f"{prefix}_corr_matrix.xlsx")
        out_heatmap = Path(f"{prefix}_corr_heatmap.png")

        corr.to_excel(out_matrix)
        title = f"{stem} Correlation Heatmap"
        if args.avg:
            title = f"{stem} (avg) Correlation Heatmap"
        plot_heatmap(corr, out_heatmap, title, args.r_mode)

        print(f"Saved {out_matrix}")
        print(f"Saved {out_heatmap}")
        return 0

    df2 = read_table(input2)
    df1, df2 = align_by_gene(df1, df2)
    expr1 = extract_expression(df1)
    expr2 = extract_expression(df2)
    if args.avg:
        expr1 = average_by_group(expr1)
        expr2 = average_by_group(expr2)

    combined = pd.concat([expr1, expr2], axis=1)
    corr_all = combined.corr(method="pearson")

    cols1 = expr1.columns.tolist()
    cols2 = expr2.columns.tolist()
    corr = corr_all.loc[cols1, cols2]
    corr = apply_r_mode(corr, args.r_mode)

    prefix = args.out_prefix or f"{input1.stem}_vs_{input2.stem}"
    if args.avg and args.out_prefix is None:
        prefix = f"{prefix}_avg"
    out_matrix = Path(f"{prefix}_corr_matrix.xlsx")
    out_heatmap = Path(f"{prefix}_corr_heatmap.png")

    corr.to_excel(out_matrix)
    title = f"{input1.stem} vs {input2.stem} Correlation Heatmap"
    if args.avg:
        title = f"{input1.stem} vs {input2.stem} (avg) Correlation Heatmap"
    plot_heatmap(corr, out_heatmap, title, args.r_mode)

    print(f"Saved {out_matrix}")
    print(f"Saved {out_heatmap}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
