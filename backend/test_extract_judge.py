#!/usr/bin/env python3
"""Teste local: extrair texto do PDF e rodar _extract_authorities.
Rodar do diretório raiz do repo com o venv do projeto:
  .venv/bin/python backend/test_extract_judge.py
"""
import sys
from pathlib import Path

# Permitir import do backend
repo_root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(repo_root))

from backend.services.cases import (
    extract_text_from_document,
    fallback_extract_case_data,
    _extract_authorities,
)

def main():
    pdf_path = repo_root / "9BC9A3B244DEAF_1032991-70.2025.4.01.0000.pdf"
    if not pdf_path.exists():
        print("Arquivo não encontrado:", pdf_path)
        return 1

    print("Extraindo texto do PDF (mesmo fluxo do backend)...")
    extracted_text = extract_text_from_document(pdf_path, pdf_path.name, "application/pdf")
    print("Total de caracteres extraídos:", len(extracted_text))

    if not extracted_text or len(extracted_text) < 100:
        print("Texto extraído vazio ou muito curto. Últimos 500 chars:")
        print(repr(extracted_text[-500:] if extracted_text else ""))
        return 1

    # Verificar se as strings esperadas existem
    text_lower = extracted_text.lower()
    print('"assinado eletronicamente por" no texto:', "assinado eletronicamente por" in text_lower)
    print('"desembargador federal" no texto:', "desembargador federal" in text_lower)
    print('"por:" no final (últimos 3k):', "por:" in extracted_text[-3000:] or "por :" in extracted_text[-3000:])

    print("\n--- Últimos 1500 caracteres do texto extraído ---")
    print(repr(extracted_text[-1500:]))
    print("---\n")

    print("Chamando _extract_authorities(text)...")
    primary, display = _extract_authorities(extracted_text)
    print("primary (judge):", repr(primary))
    print("authority_display:", repr(display))

    print("\nChamando fallback_extract_case_data (resumo)...")
    payload = fallback_extract_case_data(
        text=extracted_text,
        process_number=None,
        tribunal=None,
        judge=None,
        action_type=None,
        claim_value=None,
    )
    print("payload.judge:", repr(payload.judge))
    print("payload.authority_display:", repr(payload.authority_display))
    return 0

if __name__ == "__main__":
    sys.exit(main())
