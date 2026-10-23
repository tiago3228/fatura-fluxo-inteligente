# Atribuições de `OUTUBRODE2020.xlsx`

Processamento realizado somente com os dados presentes na planilha original.

## Regras aplicadas

- `ANA` foi interpretada como **Ana Kamilly**.
- `ARLETE` foi interpretada como **Arlete**.
- `REU` foi interpretada como **Reu**.
- `JOÃO` foi interpretado como **João Cardoso**.
- `ATENA` foi interpretada como **Atena Cardoso**, conforme a pessoa já existente nas compras/base do aplicativo.
- Somente linhas da aba `ABRIL DE 2026` com pessoa, item e valor foram tratadas como compras itemizadas.
- A aba `Planilha2` contém movimentações, pagamentos, depósitos e totais. Mesmo quando há um nome, não há item de compra suficiente para criar uma compra nova; essas linhas ficaram em revisão.
- `ARLETE 1800/ATENA`, a anotação `atena 528` junto de `JOÃO` e `CARÃO` não foram divididos ou reinterpretados automaticamente.

## Resultado

- **93 compras atribuídas**:
  - Atena Cardoso: 50
  - Arlete: 37
  - Ana Kamilly: 3
  - João Cardoso: 2
  - Reu: 1
- **15 registros para revisão**, em `OUTUBRODE2020_nao_atribuidas.csv`.
- **11 linhas de controle excluídas** por serem totais, pagamentos, depósitos ou resumos, em `OUTUBRODE2020_excluidas_controle.csv`.

O arquivo Excel consolidado contém as abas `Atribuídas`, `Não atribuídas` e `Controle excluído`.
