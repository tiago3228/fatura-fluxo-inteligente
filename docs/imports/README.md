# Processamento local de planilhas financeiras

Os arquivos de origem e os resultados podem conter informações financeiras. Mantenha-os fora do repositório e do diretório público da aplicação.

O script `scripts/process_outubro2020.py` aceita o caminho do arquivo original como primeiro argumento. Por padrão, procura o original em:

```text
~/.local/share/fatura-fluxo-inteligente-private/originals/OUTUBRODE2020.xlsx
```

Os CSVs e a planilha de revisão resultantes são gravados, por padrão, em:

```text
~/.local/share/fatura-fluxo-inteligente-private/imports/
```

Exemplo de execução local:

```bash
python3 scripts/process_outubro2020.py "$HOME/.local/share/fatura-fluxo-inteligente-private/originals/OUTUBRODE2020.xlsx"
```

Os caminhos podem ser substituídos por `FATURA_SOURCE_FILE` e `FATURA_IMPORT_OUT_DIR`. Não mova esses resultados para `public/` nem os adicione ao Git sem antes remover e classificar os dados pessoais/financeiros.
