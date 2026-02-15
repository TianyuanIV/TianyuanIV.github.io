import argparse
from pathlib import Path

import pandas as pd
import matplotlib.pyplot as plt


def _load_sheet(path, sheet_name):
    df = pd.read_excel(path, sheet_name=sheet_name)
    if df.shape[1] < 2:
        raise ValueError(f"Sheet '{sheet_name}' must have at least 2 columns.")
    df = df.iloc[:, :2].copy()
    df.columns = ["pathway", "probability"]
    df["pathway"] = df["pathway"].astype(str).str.strip()
    summary_labels = {
        "total",
        "sum",
        "\u603b\u8ba1",
        "\u603b\u548c",
        "\u5408\u8ba1",
    }
    df = df[~df["pathway"].str.lower().isin(summary_labels)]
    df["probability"] = pd.to_numeric(df["probability"], errors="coerce")
    df = df.dropna(subset=["pathway", "probability"])
    return df


def _build_relative_table(df_a, df_b, label_a, label_b):
    merged = pd.merge(
        df_a,
        df_b,
        on="pathway",
        how="outer",
        suffixes=(f"_{label_a}", f"_{label_b}"),
    )
    col_a = f"probability_{label_a}"
    col_b = f"probability_{label_b}"
    merged[[col_a, col_b]] = merged[[col_a, col_b]].fillna(0)
    merged["total"] = merged[col_a] + merged[col_b]
    merged = merged[merged["total"] > 0].copy()
    merged[f"{label_a}_ratio"] = merged[col_a] / merged["total"]
    merged[f"{label_b}_ratio"] = merged[col_b] / merged["total"]
    return merged


def _plot_relative_flow(df, output_path, label_a, label_b, color_a, color_b, title):
    y_pos = range(len(df))
    fig_height = max(4.0, 0.35 * len(df))
    fig, ax = plt.subplots(figsize=(7.5, fig_height))

    ratio_a = f"{label_a}_ratio"
    ratio_b = f"{label_b}_ratio"
    ax.barh(y_pos, df[ratio_a], color=color_a, label=label_a)
    ax.barh(y_pos, df[ratio_b], left=df[ratio_a], color=color_b, label=label_b)

    ax.set_yticks(y_pos)
    ax.set_yticklabels(df["pathway"])
    ax.invert_yaxis()
    ax.set_xlim(0, 1)
    ax.set_xlabel("Relative information flow")
    if title:
        ax.set_title(title)

    ax.axvline(0.5, color="#888888", linestyle="--", linewidth=0.8, alpha=0.7)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.legend(loc="center left", bbox_to_anchor=(1.02, 0.5))

    fig.tight_layout()
    fig.savefig(output_path, dpi=300)


def main():
    parser = argparse.ArgumentParser(
        description="Create a relative information flow plot for all pathways."
    )
    parser.add_argument("--input", default="pathway.xlsx")
    parser.add_argument("--output", default="relative_information_flow.png")
    parser.add_argument("--title", default="")
    args = parser.parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        raise FileNotFoundError(f"Input file not found: {input_path}")

    excel = pd.ExcelFile(input_path)
    if len(excel.sheet_names) < 2:
        raise ValueError("Input file must contain at least two sheets.")
    label_a = str(excel.sheet_names[0])
    label_b = str(excel.sheet_names[1])
    df_a = _load_sheet(input_path, label_a)
    df_b = _load_sheet(input_path, label_b)
    merged = _build_relative_table(df_a, df_b, label_a, label_b)
    merged = merged.sort_values(f"{label_a}_ratio", ascending=False)

    merged = merged.reset_index(drop=True)

    _plot_relative_flow(
        merged,
        args.output,
        label_a=label_a,
        label_b=label_b,
        color_a="#FF9AB5",
        color_b="#C4F2EF",
        title=args.title,
    )


if __name__ == "__main__":
    main()
