// ===== CONFIGURAÇÃO =====

// Valor de reserva, só usado SE não conseguirmos buscar a taxa real pela internet
// (ex: sem conexão). É só um "plano B" para o app não travar.
const SELIC_FALLBACK = 10.75;

// Cada produto tem uma forma de estimar sua taxa anual a partir da Selic,
// um prazo mínimo (carência, em dias) e se é isento de Imposto de Renda.
// Os percentuais do CDI usados aqui são aproximações comuns de mercado,
// bancos e corretoras diferentes oferecem taxas diferentes na vida real.
const produtos = [
  {
    nome: "Poupança",
    isentoIR: true,
    carenciaMinima: 0,
    observacao: "Liquidez imediata, mas só rende se completar um mês inteiro parado.",
    taxaAnual(selic) {
      // Regra oficial da poupança:
      if (selic > 8.5) {
        return (Math.pow(1.005, 12) - 1) * 100; // 0,5% ao mês, composto no ano
      }
      return selic * 0.7; // 70% da Selic quando a Selic está baixa
    },
  },
  {
    nome: "Tesouro Selic",
    isentoIR: false,
    carenciaMinima: 1,
    observacao: "Considerado o investimento mais seguro do Brasil. Liquidez em 1 dia útil.",
    taxaAnual(selic) {
      return selic - 0.2; // desconta ~0,2% a.a. de taxa de custódia da B3
    },
  },
  {
    nome: "CDB de liquidez diária",
    isentoIR: false,
    carenciaMinima: 0,
    observacao: "Costuma render perto de 100% do CDI. Confirme a condição exata no seu banco.",
    taxaAnual(selic) {
      return selic * 1.0;
    },
  },
  {
    nome: "CDB travado (com carência)",
    isentoIR: false,
    carenciaMinima: 365,
    observacao: "Rende mais, mas o dinheiro fica travado até o prazo combinado.",
    taxaAnual(selic) {
      return selic * 1.15;
    },
  },
  {
    nome: "LCI / LCA",
    isentoIR: true,
    carenciaMinima: 90,
    observacao: "Isento de Imposto de Renda. Precisa deixar pelo menos 90 dias parado.",
    taxaAnual(selic) {
      return selic * 0.92;
    },
  },
];

// ===== ELEMENTOS DA PÁGINA =====
const form = document.getElementById("form-simulacao");
const statusTaxa = document.getElementById("status-taxa");
const resultado = document.getElementById("resultado");
const cardsEl = document.getElementById("cards");

const formProjecao = document.getElementById("form-projecao");
const resultadoProjecao = document.getElementById("resultado-projecao");
const cardsProjecaoEl = document.getElementById("cards-projecao");

let selicAtual = null; // vamos guardar aqui a taxa buscada da internet

// ===== BUSCAR A TAXA SELIC NO BANCO CENTRAL =====
async function buscarSelic() {
  try {
    const resposta = await fetch(
      "https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados/ultimos/1?formato=json"
    );
    if (!resposta.ok) throw new Error("API respondeu com erro");

    const dados = await resposta.json();
    const taxa = parseFloat(dados[0].valor);
    statusTaxa.textContent = `Taxa Selic atual: ${taxa.toFixed(2)}% a.a. (fonte: Banco Central)`;
    return taxa;
  } catch (erro) {
    console.warn("Não foi possível buscar a Selic online, usando valor de referência.", erro);
    statusTaxa.textContent = `Não foi possível buscar a taxa online. Usando valor de referência: ${SELIC_FALLBACK}% a.a.`;
    return SELIC_FALLBACK;
  }
}

// ===== CÁLCULOS =====

// Imposto de Renda regressivo para renda fixa: quanto mais tempo parado, menos imposto
function aliquotaIR(dias) {
  if (dias <= 180) return 0.225;
  if (dias <= 360) return 0.2;
  if (dias <= 720) return 0.175;
  return 0.15;
}

function simular(valor, dias, selic) {
  return produtos
    .map((produto) => {
      const taxaAnualPercentual = produto.taxaAnual(selic);
      const taxaAnual = taxaAnualPercentual / 100;
      const anos = dias / 365;

      const valorBruto = valor * Math.pow(1 + taxaAnual, anos);
      const rendimentoBruto = valorBruto - valor;

      const aliquota = produto.isentoIR ? 0 : aliquotaIR(dias);
      const rendimentoLiquido = rendimentoBruto * (1 - aliquota);
      const valorLiquido = valor + rendimentoLiquido;

      const disponivel = dias >= produto.carenciaMinima;

      return {
        ...produto,
        taxaAnualPercentual,
        valorLiquido,
        rendimentoLiquido,
        disponivel,
      };
    })
    .sort((a, b) => b.rendimentoLiquido - a.rendimentoLiquido);
}

// Quanto preciso depositar TODO MÊS (valor igual, sempre) pra chegar num objetivo,
// usando juros compostos. Essa é a fórmula de "anuidade" ao contrário:
// em vez de calcular o total no final, descobrimos o depósito mensal necessário.
function calcularContribuicaoMensal(objetivo, meses, selic) {
  const diasTotais = meses * 30;

  return produtos
    .map((produto) => {
      const taxaAnualPercentual = produto.taxaAnual(selic);
      const taxaAnualBruta = taxaAnualPercentual / 100;

      // Aproxima o efeito do IR no período total, pra simplificar o cálculo
      const aliquota = produto.isentoIR ? 0 : aliquotaIR(diasTotais);
      const taxaAnualLiquida = taxaAnualBruta * (1 - aliquota);

      // Converte a taxa anual líquida para uma taxa mensal equivalente
      const i = Math.pow(1 + taxaAnualLiquida, 1 / 12) - 1;
      const n = meses;

      // Fórmula da anuidade: PMT = FV * i / ((1+i)^n - 1)
      // Se a taxa for ~0, simplifica para uma divisão simples (evita dividir por zero)
      const contribuicaoMensal =
        Math.abs(i) < 1e-9 ? objetivo / n : (objetivo * i) / (Math.pow(1 + i, n) - 1);

      const disponivel = diasTotais >= produto.carenciaMinima;

      return { ...produto, contribuicaoMensal, disponivel };
    })
    .sort((a, b) => a.contribuicaoMensal - b.contribuicaoMensal); // menor valor mensal = melhor
}

function renderizarProjecao(resultados) {
  cardsProjecaoEl.innerHTML = "";

  const melhor = resultados.find((r) => r.disponivel);

  resultados.forEach((r) => {
    const card = document.createElement("div");
    card.className = "card";
    if (!r.disponivel) card.classList.add("indisponivel");
    if (melhor && r.nome === melhor.nome) card.classList.add("melhor");

    card.innerHTML = `
      <h3>${r.nome} ${melhor && r.nome === melhor.nome ? "🏆" : ""}</h3>
      ${
        r.disponivel
          ? `<p class="valor">${formatarMoeda(r.contribuicaoMensal)} / mês</p>`
          : `<p class="aviso">Precisa de pelo menos ${r.carenciaMinima} dias parado</p>`
      }
      <p class="observacao">${r.observacao}</p>
    `;

    cardsProjecaoEl.appendChild(card);
  });

  resultadoProjecao.classList.remove("escondido");
}

// ===== EXIBIR RESULTADO NA TELA =====

function formatarMoeda(valor) {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function renderizar(resultados) {
  cardsEl.innerHTML = "";

  // A melhor opção é a de maior rendimento líquido ENTRE as disponíveis para o prazo
  const melhor = resultados.find((r) => r.disponivel);

  resultados.forEach((r) => {
    const card = document.createElement("div");
    card.className = "card";
    if (!r.disponivel) card.classList.add("indisponivel");
    if (melhor && r.nome === melhor.nome) card.classList.add("melhor");

    card.innerHTML = `
      <h3>${r.nome} ${melhor && r.nome === melhor.nome ? "🏆" : ""}</h3>
      <p class="taxa">${r.taxaAnualPercentual.toFixed(2)}% a.a. aprox.</p>
      ${
        r.disponivel
          ? `<p class="valor">${formatarMoeda(r.valorLiquido)}</p>
             <p class="rendimento">+${formatarMoeda(r.rendimentoLiquido)} líquido</p>`
          : `<p class="aviso">Precisa de pelo menos ${r.carenciaMinima} dias parado</p>`
      }
      <p class="observacao">${r.observacao}</p>
    `;

    cardsEl.appendChild(card);
  });

  resultado.classList.remove("escondido");
}

// ===== EVENTOS =====

form.addEventListener("submit", (evento) => {
  evento.preventDefault();

  const valor = parseFloat(document.getElementById("valor").value);
  const dias = parseInt(document.getElementById("prazo").value, 10);

  const resultados = simular(valor, dias, selicAtual);
  renderizar(resultados);
});

formProjecao.addEventListener("submit", (evento) => {
  evento.preventDefault();

  const objetivo = parseFloat(document.getElementById("objetivo").value);
  const meses = parseInt(document.getElementById("meses").value, 10);

  const resultados = calcularContribuicaoMensal(objetivo, meses, selicAtual);
  renderizarProjecao(resultados);
});

// Busca a taxa assim que a página carrega, antes mesmo de simular algo
buscarSelic().then((taxa) => {
  selicAtual = taxa;
});

// Registra o service worker, que permite instalar o app na tela inicial do celular
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js");
}
