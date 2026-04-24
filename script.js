const FAVORITOS_CHAVE = "arquivo01:favoritos";
const CARRINHO_CHAVE = "arquivo01:carrinho";
const CHECKOUT_RESUMO_CHAVE = "arquivo01:checkoutResumo";
const CEP_FRETE_SUGESTAO = "arquivo01:ultimoCepFrete";
const RESUMO_FRETE_VAZIO = {
  discount: 0,
  shipping: 0,
  freteCep: "",
  freteOpcaoId: null,
  fretePrazo: null,
  freteNome: "",
};
let produtos = [];

function lerResumoCarrinho() {
  const raw = lerStorage(CHECKOUT_RESUMO_CHAVE, {});
  const m = { ...RESUMO_FRETE_VAZIO, ...raw, discount: raw.discount != null ? raw.discount : 0 };
  if (m.freteCep) m.freteCep = String(m.freteCep).replace(/\D/g, "");
  if (!m.freteOpcaoId) m.shipping = 0;
  return m;
}

function formatarMoeda(valor) {
  return `R$ ${valor.toFixed(2).replace(".", ",")}`;
}

function parsePreco(preco) {
  return Number((preco || "").replace("R$", "").replace(/\./g, "").replace(",", ".").trim()) || 0;
}

function lerStorage(chave, fallback) {
  try {
    const dados = localStorage.getItem(chave);
    return dados ? JSON.parse(dados) : fallback;
  } catch {
    return fallback;
  }
}

function salvarStorage(chave, valor) {
  localStorage.setItem(chave, JSON.stringify(valor));
}

function lerFavoritos() {
  return lerStorage(FAVORITOS_CHAVE, []);
}

function salvarFavoritos(ids) {
  salvarStorage(FAVORITOS_CHAVE, ids);
}

function lerCarrinho() {
  return lerStorage(CARRINHO_CHAVE, []);
}

function salvarCarrinho(itens) {
  salvarStorage(CARRINHO_CHAVE, itens);
}

function rotuloStatusPedido(status) {
  const s = (status || "").toLowerCase();
  const map = {
    aguardando_pagamento: "Aguardando pagamento",
    pago: "Pago",
    recebido: "Recebido",
    enviado: "Enviado",
    entregue: "Entregue",
    cancelado: "Cancelado",
  };
  return map[s] || status;
}

function renderLinhasPedidos(orders, alvo) {
  if (!alvo) return;
  alvo.innerHTML = "";
  if (!orders?.length) {
    alvo.innerHTML = "<li>Nenhum pedido ainda.</li>";
    return;
  }
  orders.forEach((order) => {
    const li = document.createElement("li");
    li.textContent = `#A01-${String(order.id).padStart(4, "0")} — ${rotuloStatusPedido(order.status)} — ${order.total}`;
    alvo.appendChild(li);
  });
}

async function apiFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Erro na requisição.");
  return data;
}

function produtoFallback() {
  return [
    { id: "vestido-rose", nome: "Vestido Rosé Plissado", tipo: "Vestido", preco: "R$ 249,00", imagem: "https://images.unsplash.com/photo-1595777457583-95e059d581b8?auto=format&fit=crop&w=900&q=80", cor: "Rosé", tamanhos: ["P", "M", "G", "GG"], descricao: "Vestido plissado selecionado." },
    { id: "blazer-xadrez", nome: "Blazer Xadrez Vintage", tipo: "Blazer", preco: "R$ 229,00", imagem: "https://images.unsplash.com/photo-1594938298603-c8148c4dae35?auto=format&fit=crop&w=900&q=80", cor: "Cinza", tamanhos: ["P", "M", "G"], descricao: "Blazer xadrez com forro." },
    { id: "sueter-menta", nome: "Suéter Verde Menta", tipo: "Suéter", preco: "R$ 139,00", imagem: "https://images.unsplash.com/photo-1616690710400-a16d146927c5?auto=format&fit=crop&w=900&q=80", cor: "Verde", tamanhos: ["P", "M", "G", "GG"], descricao: "Tricot suave." },
    { id: "calca-jeans-reta", nome: "Calça Jeans Reta", tipo: "Calça", preco: "R$ 139,00", imagem: "https://images.unsplash.com/photo-1541099649105-f69ad21f3246?auto=format&fit=crop&w=900&q=80", cor: "Azul", tamanhos: ["36", "38", "40", "42"], descricao: "Corte reto, lavagem clássica." },
    { id: "bolsa-couro", nome: "Bolsa Estruturada Couro", tipo: "Acessório", preco: "R$ 189,00", imagem: "https://images.unsplash.com/photo-1591561954557-26941169b49e?auto=format&fit=crop&w=900&q=80", cor: "Marrom", tamanhos: ["U"], descricao: "Couro com boa estrutura." },
    { id: "camisa-offwhite-seda", nome: "Camisa Off-White Seda", tipo: "Blusa", preco: "R$ 197,00", imagem: "https://images.unsplash.com/photo-1583845112203-454497f4f63d?auto=format&fit=crop&w=900&q=80", cor: "Off-white", tamanhos: ["P", "M", "G", "GG"], descricao: "Seda com caimento leve." },
  ];
}

function normalizarProduto(p) {
  if (!p) return p;
  const t = p.tamanhos;
  const tamanhos = Array.isArray(t) && t.length ? t : ["P", "M", "G"];
  const imagens =
    Array.isArray(p.imagens) && p.imagens.length
      ? [...new Set(p.imagens.map(String))].filter(Boolean)
      : p.imagem
        ? [p.imagem]
        : [];
  return { ...p, tamanhos, imagens };
}

async function carregarProdutosDoBanco() {
  try {
    const data = await apiFetch("/api/products");
    if (Array.isArray(data.products) && data.products.length) {
      produtos = data.products.map(normalizarProduto);
    } else {
      produtos = produtoFallback();
    }
  } catch {
    produtos = produtoFallback();
  }
}

let filtroCategoria = "";
let filtroCor = "";
let filtroPrecoMin = null;
let filtroPrecoMax = null;

function filtrarLista(lista) {
  return lista.filter((p) => {
    if (filtroCategoria && p.tipo !== filtroCategoria) return false;
    if (filtroCor && (p.cor || "") !== filtroCor) return false;
    const preco = parsePreco(p.preco);
    if (filtroPrecoMin != null && preco < filtroPrecoMin) return false;
    if (filtroPrecoMax != null && preco > filtroPrecoMax) return false;
    return true;
  });
}

function popularOpcoesFiltroCor() {
  const sel = document.getElementById("filtro-cor");
  if (!sel) return;
  const cores = [...new Set(produtos.map((p) => p.cor).filter(Boolean))].sort();
  const atual = filtroCor;
  sel.innerHTML = '<option value="">Todas</option>';
  cores.forEach((c) => {
    const o = document.createElement("option");
    o.value = c;
    o.textContent = c;
    if (c === atual) o.selected = true;
    sel.appendChild(o);
  });
}

function atualizarTextoBotaoFavorito(botao, ativo) {
  botao.textContent = ativo ? "♥ Favoritado" : "♡ Favoritar peça";
  botao.classList.toggle("favorito-ativo", ativo);
  botao.setAttribute("aria-pressed", String(ativo));
}

function opcoesTamanhoSelect(produto) {
  const tams = Array.isArray(produto.tamanhos) && produto.tamanhos.length ? produto.tamanhos : ["Único"];
  return tams.map((t) => `<option value="${t}">${t}</option>`).join("");
}

function criarCardLista(produto) {
  const p = normalizarProduto(produto);
  const card = document.createElement("article");
  card.className = "card";
  card.innerHTML = `
    <a class="card-img-link" href="produto.html?id=${encodeURIComponent(p.id)}">
      <img src="${p.imagem}" alt="${p.nome}">
    </a>
    <div class="card-info">
      <h3><a class="link-invisivel" href="produto.html?id=${encodeURIComponent(p.id)}">${p.nome}</a></h3>
      <p>${p.tipo} · ${p.cor || ""}</p>
      <strong>${p.preco}</strong>
      <label for="tam-${p.id}">Tamanho</label>
      <select id="tam-${p.id}" data-tamanho-for="${p.id}">${opcoesTamanhoSelect(p)}</select>
      <div class="card-acoes">
        <a class="btn" href="produto.html?id=${encodeURIComponent(p.id)}">Ver detalhes</a>
        <button class="btn btn-principal" type="button" data-add-cart="${p.id}">Adicionar</button>
      </div>
    </div>
  `;
  return card;
}

function criarCardFavorito(produto) {
  const p = normalizarProduto(produto);
  const card = document.createElement("article");
  card.className = "card";
  card.innerHTML = `
    <a class="card-img-link" href="produto.html?id=${encodeURIComponent(p.id)}">
      <img src="${p.imagem}" alt="${p.nome}">
    </a>
    <div class="card-info">
      <h3><a class="link-invisivel" href="produto.html?id=${encodeURIComponent(p.id)}">${p.nome}</a></h3>
      <p>${p.tipo}</p>
      <strong>${p.preco}</strong>
      <button class="btn" type="button" data-remove-fav="${p.id}">Remover dos favoritos</button>
    </div>
  `;
  return card;
}

function renderizarProdutos(containerId, limite) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const lista = limite ? filtrarLista(produtos).slice(0, limite) : filtrarLista(produtos);
  container.innerHTML = "";
  lista.forEach((produto) => container.appendChild(criarCardLista(produto)));
  configurarBotoesCarrinho();
  configurarRemoverFavoritos();
}

function renderizarCatalogo() {
  const container = document.getElementById("catalogo");
  if (!container) return;
  const lista = filtrarLista(produtos);
  container.innerHTML = "";
  lista.forEach((produto) => container.appendChild(criarCardLista(produto)));
  configurarBotoesCarrinho();
  configurarRemoverFavoritos();
}

function atualizarResumoFavoritos() {
  const total = lerFavoritos().length;
  const contador = document.getElementById("favoritos-total");
  if (contador) contador.textContent = String(total);
  document.querySelectorAll(".js-fav-count").forEach((item) => {
    item.textContent = String(total);
  });
}

function renderizarFavoritos() {
  const container = document.getElementById("lista-favoritos");
  if (!container) return;
  const vazio = document.getElementById("favoritos-vazio");
  const itens = produtos.filter((produto) => lerFavoritos().includes(produto.id));
  container.innerHTML = "";
  if (!itens.length) {
    if (vazio) vazio.hidden = false;
    return;
  }
  if (vazio) vazio.hidden = true;
  itens.forEach((produto) => container.appendChild(criarCardFavorito(produto)));
  configurarRemoverFavoritos();
}

function configurarRemoverFavoritos() {
  document.querySelectorAll("[data-remove-fav]").forEach((botao) => {
    if (botao.dataset.boundRmf === "true") return;
    botao.dataset.boundRmf = "true";
    botao.addEventListener("click", () => {
      const id = botao.getAttribute("data-remove-fav");
      const atual = lerFavoritos().filter((x) => x !== id);
      salvarFavoritos(atual);
      atualizarResumoFavoritos();
      renderizarFavoritos();
    });
  });
}

function adicionarAoCarrinho(produtoId, tamanho) {
  const produto = produtos.find((item) => item.id === produtoId);
  if (!produto) return;
  const tam = tamanho || "Único";
  const carrinho = lerCarrinho();
  const idx = carrinho.findIndex((item) => item.id === produtoId && (item.tamanho || "Único") === tam);
  if (idx >= 0) carrinho[idx].quantidade += 1;
  else carrinho.push({ ...normalizarProduto(produto), quantidade: 1, tamanho: tam });
  salvarCarrinho(carrinho);
  atualizarContadorCarrinhoHeader();
  mostrarToasterCarrinho();
}

function contarItensCarrinho() {
  return lerCarrinho().reduce((a, it) => a + (it.quantidade || 1), 0);
}

function atualizarContadorCarrinhoHeader() {
  const n = contarItensCarrinho();
  document.querySelectorAll(".js-cart-count").forEach((el) => {
    el.textContent = String(n);
    el.classList.toggle("contador-menu--vazio", n === 0);
  });
}

function mostrarToasterCarrinho() {
  let t = document.getElementById("toast-carrinho");
  if (!t) {
    t = document.createElement("div");
    t.id = "toast-carrinho";
    t.className = "toast-carrinho";
    t.setAttribute("role", "status");
    t.innerHTML = `
      <p>Peça adicionada ao carrinho.</p>
      <div class="toast-carrinho__acoes">
        <a class="btn btn-principal toast-carrinho__btn" href="carrinho.html">Ver carrinho</a>
        <button type="button" class="btn toast-carrinho__btn" id="toast-carrinho-fechar">Continuar comprando</button>
      </div>
    `;
    document.body.appendChild(t);
    t.querySelector("#toast-carrinho-fechar")?.addEventListener("click", () => {
      t.hidden = true;
    });
  }
  t.hidden = false;
  window.clearTimeout(mostrarToasterCarrinho._t);
  mostrarToasterCarrinho._t = window.setTimeout(() => {
    t.hidden = true;
  }, 10000);
}

function inserirAtalhoCarrinhoNoTopo() {
  if (document.getElementById("topo-carrinho") || !document.querySelector(".topo")) return;
  const topo = document.querySelector(".topo");
  const a = document.createElement("a");
  a.id = "topo-carrinho";
  a.className = "topo-carrinho";
  a.href = "carrinho.html";
  a.setAttribute("aria-label", "Abrir carrinho de compras");
  a.innerHTML = `<span class="topo-carrinho__ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="20" r="1.5" fill="currentColor" stroke="none"/><circle cx="17" cy="20" r="1.5" fill="currentColor" stroke="none"/><path d="M3 4h2l1 10h12l2-7H6"/></svg></span><span class="contador-menu js-cart-count contador-menu--vazio">0</span>`;
  const menu = document.getElementById("btn-menu-principal");
  if (menu) topo.insertBefore(a, menu);
  else topo.appendChild(a);
  atualizarContadorCarrinhoHeader();
}

function tamanhoSelecionadoPara(produtoId) {
  const sel = document.querySelector(`select[data-tamanho-for="${produtoId}"]`);
  if (sel) return sel.value;
  const noProduto = document.getElementById("tamanho");
  if (noProduto && window.location.pathname.includes("produto.html")) return noProduto.value;
  return "Único";
}

function configurarBotoesCarrinho() {
  document.querySelectorAll("[data-add-cart]").forEach((botao) => {
    if (botao.dataset.boundCart === "true") return;
    botao.dataset.boundCart = "true";
    botao.addEventListener("click", (e) => {
      e.preventDefault();
      const id = botao.getAttribute("data-add-cart");
      const tam = tamanhoSelecionadoPara(id);
      adicionarAoCarrinho(id, tam);
    });
  });
}

function configurarBotoesFavoritos() {
  document.querySelectorAll("[data-favorito]").forEach((botao) => {
    if (!botao.getAttribute("data-favorito")) return;
    if (botao.dataset.boundFav === "true") return;
    botao.dataset.boundFav = "true";
    botao.addEventListener("click", () => {
      const idProduto = botao.getAttribute("data-favorito");
      const favoritos = lerFavoritos();
      const ativo = favoritos.includes(idProduto);
      const atualizados = ativo ? favoritos.filter((x) => x !== idProduto) : [...favoritos, idProduto];
      salvarFavoritos(atualizados);
      atualizarTextoBotaoFavorito(botao, !ativo);
      atualizarResumoFavoritos();
      if (document.getElementById("lista-favoritos")) renderizarFavoritos();
    });
  });
}

function sincronizarUrlCatalogoCategoria() {
  if (!window.location.pathname.includes("catalogo.html")) return;
  const cat = (filtroCategoria || "").trim();
  const qs = cat ? `?categoria=${encodeURIComponent(cat)}` : "";
  const path = `catalogo.html${qs}`;
  window.history.replaceState(null, "", path);
}

function iniciarMenuLateral() {
  const src = document.querySelector("header .nav-principal");
  const root = document.getElementById("drawer-nav-root");
  const btn = document.getElementById("btn-menu-principal");
  const drawer = document.getElementById("drawer-menu");
  if (!src || !root || !btn || !drawer) return;

  if (!root.querySelector("nav")) {
    const c = src.cloneNode(true);
    c.classList.add("nav-principal--drawer");
    c.removeAttribute("id");
    root.appendChild(c);
  }

  function abrir() {
    drawer.removeAttribute("hidden");
    btn.setAttribute("aria-expanded", "true");
    document.body.classList.add("drawer-open");
  }

  function fechar() {
    drawer.setAttribute("hidden", "");
    btn.setAttribute("aria-expanded", "false");
    document.body.classList.remove("drawer-open");
  }

  btn.addEventListener("click", () => {
    if (drawer.hasAttribute("hidden")) abrir();
    else fechar();
  });
  drawer.querySelectorAll("[data-close-drawer]").forEach((el) => {
    el.addEventListener("click", () => fechar());
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !drawer.hasAttribute("hidden")) fechar();
  });
  root.querySelectorAll("a").forEach((a) => {
    a.addEventListener("click", () => fechar());
  });
  window.addEventListener("resize", () => {
    if (window.innerWidth >= 1024) fechar();
  });
}

function iniciarFiltrosCatalogo() {
  if (!document.getElementById("catalogo")) return;
  const params = new URLSearchParams(window.location.search);
  const catUrl = params.get("categoria");
  if (catUrl) filtroCategoria = catUrl;

  document.querySelectorAll("#filtros-categoria [data-cat]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#filtros-categoria .filtro").forEach((b) => b.classList.remove("ativo"));
      btn.classList.add("ativo");
      filtroCategoria = btn.getAttribute("data-cat") || "";
      sincronizarUrlCatalogoCategoria();
      renderizarCatalogo();
    });
  });

  if (catUrl) {
    document.querySelectorAll("#filtros-categoria [data-cat]").forEach((btn) => {
      btn.classList.toggle("ativo", (btn.getAttribute("data-cat") || "") === filtroCategoria);
    });
  }

  const selCor = document.getElementById("filtro-cor");
  if (selCor) {
    selCor.addEventListener("change", () => {
      filtroCor = selCor.value;
    });
  }

  document.getElementById("aplicar-filtros")?.addEventListener("click", () => {
    const min = document.getElementById("preco-min")?.value;
    const max = document.getElementById("preco-max")?.value;
    const cor = document.getElementById("filtro-cor")?.value || "";
    filtroCor = cor;
    filtroPrecoMin = min ? Number(min) : null;
    filtroPrecoMax = max ? Number(max) : null;
    renderizarCatalogo();
  });
}

async function iniciarPaginaProduto() {
  const elErro = document.getElementById("produto-nao-encontrado");
  const bloco = document.getElementById("produto-detalhe");
  const id = new URLSearchParams(window.location.search).get("id");
  if (!id) {
    if (elErro) {
      elErro.hidden = false;
      elErro.textContent = "Nenhuma peça selecionada. Abra a partir do catálogo.";
    }
    if (bloco) bloco.style.display = "none";
    return;
  }
  let produto;
  try {
    const data = await apiFetch(`/api/product/${encodeURIComponent(id)}`);
    produto = normalizarProduto(data.product);
    produtos = produtos.map((p) => (p.id === produto.id ? produto : p));
    if (!produtos.find((p) => p.id === produto.id)) produtos.push(produto);
  } catch {
    produto = normalizarProduto(produtoFallback().find((p) => p.id === id) || null);
  }
  if (!produto) {
    if (elErro) {
      elErro.hidden = false;
      elErro.textContent = "Peça não encontrada.";
    }
    if (bloco) bloco.style.display = "none";
    return;
  }
  if (bloco) bloco.style.display = "";
  const titulo = document.getElementById("produto-titulo");
  const preco = document.getElementById("produto-preco");
  const desc = document.getElementById("produto-descricao");
  const tagCor = document.getElementById("produto-cor");
  if (titulo) titulo.textContent = produto.nome;
  if (preco) preco.textContent = produto.preco;
  if (desc) desc.textContent = produto.descricao || "Peça de curadoria, veja as fotos e a descrição no site.";
  if (tagCor) {
    if (produto.cor && produto.cor !== "—") {
      tagCor.textContent = `Cor: ${produto.cor}`;
      tagCor.style.display = "inline-block";
    } else {
      tagCor.style.display = "none";
    }
  }
  const sel = document.getElementById("tamanho");
  if (sel) {
    sel.innerHTML = opcoesTamanhoSelect(produto);
    if (sel.options[0]) sel.selectedIndex = 0;
  }
  const urlsGaleria = produto.imagens && produto.imagens.length
    ? produto.imagens
    : produto.imagem
      ? [produto.imagem]
      : [];
  const slots = ["produto-img-1", "produto-img-2", "produto-img-3"];
  slots.forEach((id, i) => {
    const img = document.getElementById(id);
    if (img) {
      const u = urlsGaleria[i] || urlsGaleria[0] || "";
      img.src = u;
      img.alt = produto.nome;
    }
  });
  const fav = document.getElementById("btn-favorito-produto");
  if (fav) {
    fav.setAttribute("data-favorito", produto.id);
    atualizarTextoBotaoFavorito(fav, lerFavoritos().includes(produto.id));
  }
  const add = document.getElementById("btn-add-cart");
  if (add) {
    add.setAttribute("data-add-cart", produto.id);
  }
  document.title = `${produto.nome} | Arquivo 01`;
  configurarBotoesCarrinho();
  configurarBotoesFavoritos();
  iniciarLightboxGaleria(".produto-galeria");
  iniciarFreteProduto();
}

function iniciarFreteProduto() {
  const input = document.getElementById("cep-frete-produto");
  const btn = document.getElementById("btn-frete-produto");
  const host = document.getElementById("produto-frete-opcoes");
  const msg = document.getElementById("frete-produto-msg");
  if (!input || !btn || !host) return;
  const sug = localStorage.getItem(CEP_FRETE_SUGESTAO) || "";
  if (sug && sug.length === 8) input.value = sug.replace(/(\d{5})(\d{3})/, "$1-$2");

  const rodarFreteProduto = async () => {
    const c = (input.value || "").replace(/\D/g, "");
    if (c.length !== 8) {
      if (msg) msg.textContent = "CEP com 8 dígitos.";
      return;
    }
    localStorage.setItem(CEP_FRETE_SUGESTAO, c);
    const pack = (await buscarOpcoesFrete(c)) || opcoesFreteLocal(c);
    if (!pack?.opcoes?.length) {
      if (msg) msg.textContent = "Não foi possível calcular.";
      return;
    }
    if (msg) msg.textContent = "O mesmo cálculo será usado no carrinho e no checkout. Escolha a entrega abaixo.";
    host.style.display = "flex";
    renderRadiosFrete(
      pack.opcoes,
      "freteProd",
      null,
      (o) => {
        aplicarOpcaoNoResumo(c, o);
        if (msg) {
          msg.textContent = `Gravado: ${o.nome} (${formatarMoeda(o.valor)}).`;
        }
      },
      host
    );
  };

  btn.addEventListener("click", () => {
    rodarFreteProduto();
  });
  input.addEventListener("blur", () => {
    if ((input.value || "").replace(/\D/g, "").length === 8) rodarFreteProduto();
  });
}

function baseFretePorRegiao(cep8) {
  const prefixo = Number.parseInt(cep8.slice(0, 2), 10);
  if (Number.isNaN(prefixo)) return { base: 24, prazo: 5 };
  if (prefixo <= 19) return { base: 16, prazo: 2 };
  if (prefixo <= 39) return { base: 22, prazo: 3 };
  if (prefixo <= 69) return { base: 28, prazo: 5 };
  return { base: 34, prazo: 7 };
}

function opcoesFreteLocal(cep8) {
  const { base, prazo } = baseFretePorRegiao(cep8);
  return {
    cep_destino: cep8,
    opcoes: [
      {
        id: "economica",
        nome: "Econômica (estimativa, envio padrão)",
        valor: Math.round(base * 0.9 * 100) / 100,
        prazo_dias: prazo + 3,
      },
      {
        id: "padrao",
        nome: "Padrão (estimativa, mais rápido)",
        valor: Math.round(base * 1.08 * 100) / 100,
        prazo_dias: Math.max(1, prazo),
      },
    ],
    nota: "Estimativa local (Flask inativo? Use a API do servidor).",
  };
}

async function buscarOpcoesFrete(cep) {
  const c = (cep || "").replace(/\D/g, "");
  if (c.length !== 8) return null;
  try {
    return await apiFetch(`/api/frete-estimativa/${c}`);
  } catch {
    return opcoesFreteLocal(c);
  }
}

function aplicarOpcaoNoResumo(cep, opc) {
  const r = lerResumoCarrinho();
  const freteCep = String(cep || "").replace(/\D/g, "");
  if (freteCep.length !== 8) return;
  salvarStorage(CHECKOUT_RESUMO_CHAVE, {
    ...r,
    freteCep,
    freteOpcaoId: opc.id,
    shipping: Number(opc.valor),
    fretePrazo: opc.prazo_dias,
    freteNome: opc.nome,
  });
}

function renderRadiosFrete(opcoes, name, selecionado, onSelecion, host) {
  if (!host) return;
  host.innerHTML = "";
  opcoes.forEach((o) => {
    const id = `frete-${name}-${o.id}`;
    const label = document.createElement("label");
    label.className = "opcoes-frete__linha";
    const rb = document.createElement("input");
    rb.type = "radio";
    rb.name = name;
    rb.value = o.id;
    rb.checked = selecionado === o.id;
    rb.setAttribute("data-frete-json", JSON.stringify(o));
    rb.addEventListener("change", () => onSelecion(o));
    const span = document.createElement("span");
    span.className = "opcoes-frete__texto";
    span.textContent = `${o.nome} — ${formatarMoeda(o.valor)} — até ${o.prazo_dias} dia(s) úteis`;
    label.appendChild(rb);
    label.appendChild(span);
    host.appendChild(label);
  });
}

function resumoCarrinhoAtual() {
  const carrinho = lerCarrinho();
  const subtotal = carrinho.reduce((acc, item) => acc + parsePreco(item.preco) * item.quantidade, 0);
  const resumo = lerResumoCarrinho();
  return {
    carrinho,
    subtotal,
    ...resumo,
    total: Math.max(subtotal - (resumo.discount || 0) + (resumo.shipping || 0), 0),
  };
}

function iniciarPaginaCarrinho() {
  const lista = document.getElementById("lista-carrinho");
  if (!lista) return;
  const vazio = document.getElementById("carrinho-vazio");
  const valorSubtotal = document.getElementById("valor-subtotal");
  const valorDesconto = document.getElementById("valor-desconto");
  const valorFrete = document.getElementById("valor-frete");
  const valorTotal = document.getElementById("valor-total");
  const campoCep = document.getElementById("cep-frete");
  const freteResultado = document.getElementById("frete-resultado");
  const campoCupom = document.getElementById("cupom-desconto");
  const cupomResultado = document.getElementById("cupom-resultado");
  const cupons = { ARQUIVO10: 0.1, BRECHO15: 0.15, PRIMEIRACOMPRA: 0.12 };

  function render() {
    const { carrinho, subtotal, shipping, discount, total, freteOpcaoId } = resumoCarrinhoAtual();
    lista.innerHTML = "";
    if (!carrinho.length) {
      vazio.hidden = false;
    } else {
      vazio.hidden = true;
      carrinho.forEach((item) => {
        const article = document.createElement("article");
        article.className = "item-carrinho";
        const tam = item.tamanho ? ` · Tam. ${item.tamanho}` : "";
        article.innerHTML = `
          <img src="${item.imagem}" alt="${item.nome}" />
          <div>
            <h3>${item.nome}</h3>
            <p>${item.tipo}${tam} · Qtd: ${item.quantidade}</p>
            <p class="preco">${item.preco}</p>
          </div>
        `;
        lista.appendChild(article);
      });
    }
    if (valorSubtotal) valorSubtotal.textContent = formatarMoeda(subtotal);
    if (valorDesconto) valorDesconto.textContent = `- ${formatarMoeda(discount || 0)}`;
    if (valorFrete) {
      if (!freteOpcaoId) valorFrete.textContent = "A definir";
      else valorFrete.textContent = formatarMoeda(shipping || 0);
    }
    if (valorTotal) valorTotal.textContent = formatarMoeda(total);
  }

  const hostFreteCarr = document.getElementById("carrinho-frete-opcoes");

  const r0 = lerResumoCarrinho();
  if (r0.freteCep && campoCep) {
    const x = r0.freteCep.replace(/(\d{5})(\d{3})/, "$1-$2");
    if (r0.freteCep.length === 8) campoCep.value = x;
  }
  if (r0.freteCep && r0.freteOpcaoId && hostFreteCarr) {
    (async () => {
      const p = (await buscarOpcoesFrete(r0.freteCep)) || opcoesFreteLocal(r0.freteCep);
      if (p?.opcoes) {
        hostFreteCarr.style.display = "flex";
        renderRadiosFrete(
          p.opcoes,
          "freteCarr",
          r0.freteOpcaoId,
          (o) => {
            aplicarOpcaoNoResumo(r0.freteCep, o);
            render();
          },
          hostFreteCarr
        );
        if (freteResultado) freteResultado.textContent = "Opções de entrega (do seu último cálculo).";
      }
    })();
  }

  document.getElementById("cep-frete")?.addEventListener("blur", () => {
    const cep = (campoCep?.value || "").replace(/\D/g, "");
    if (cep.length === 8) document.getElementById("calcular-frete")?.click();
  });

  document.getElementById("calcular-frete")?.addEventListener("click", async () => {
    const cep = (campoCep?.value || "").replace(/\D/g, "");
    if (cep.length !== 8) {
      freteResultado.textContent = "CEP inválido. Use 8 dígitos.";
      if (hostFreteCarr) {
        hostFreteCarr.style.display = "none";
        hostFreteCarr.innerHTML = "";
      }
      return;
    }
    const at = resumoCarrinhoAtual();
    localStorage.setItem(CEP_FRETE_SUGESTAO, cep);
    const pack = (await buscarOpcoesFrete(cep)) || opcoesFreteLocal(cep);
    if (!pack?.opcoes?.length) {
      freteResultado.textContent = "Não foi possível calcular o frete. Tente de novo.";
      return;
    }
    freteResultado.textContent = "Escolha uma opção de entrega abaixo.";
    if (hostFreteCarr) {
      hostFreteCarr.style.display = "flex";
      const sel = at.freteCep === cep ? at.freteOpcaoId : null;
      renderRadiosFrete(
        pack.opcoes,
        "freteCarr",
        sel,
        (o) => {
          aplicarOpcaoNoResumo(cep, o);
          if (pack.nota) freteResultado.textContent = pack.nota;
          else freteResultado.textContent = "Frete e prazo de referência (simulação).";
          render();
        },
        hostFreteCarr
      );
    }
  });

  document.getElementById("aplicar-cupom")?.addEventListener("click", () => {
    const codigo = (campoCupom?.value || "").trim().toUpperCase();
    const atual = resumoCarrinhoAtual();
    if (!codigo || !cupons[codigo]) {
      const r = lerResumoCarrinho();
      salvarStorage(CHECKOUT_RESUMO_CHAVE, { ...r, discount: 0 });
      cupomResultado.textContent = "Cupom inválido ou expirado.";
      render();
      return;
    }
    const desconto = atual.subtotal * cupons[codigo];
    const r = lerResumoCarrinho();
    salvarStorage(CHECKOUT_RESUMO_CHAVE, { ...r, discount: desconto });
    cupomResultado.textContent = `Cupom aplicado: ${Math.round(cupons[codigo] * 100)}% de desconto.`;
    render();
  });

  document.getElementById("btn-carrinho-checkout")?.addEventListener("click", (e) => {
    if (!resumoCarrinhoAtual().carrinho.length) return;
    if (!resumoCarrinhoAtual().freteOpcaoId) {
      e.preventDefault();
      if (freteResultado) {
        freteResultado.textContent =
          "Informe o CEP, clique em Calcular e escolha uma opção de entrega antes de ir ao pagamento.";
      }
    }
  });

  render();
}

function iniciarCheckout() {
  const form = document.getElementById("form-checkout");
  if (!form) return;
  const feedback = document.getElementById("checkout-feedback");
  const containerItens = document.getElementById("checkout-itens");
  if (!containerItens) return;
  const subtotalEl = document.getElementById("checkout-subtotal");
  const descontoEl = document.getElementById("checkout-desconto");
  const freteEl = document.getElementById("checkout-frete");
  const totalEl = document.getElementById("checkout-total");
  const hostFrete = document.getElementById("checkout-frete-opcoes");
  const notaFrete = document.getElementById("checkout-frete-nota");
  const avisoFrete = document.getElementById("checkout-aviso-frete");
  const btnPagar = document.getElementById("btn-finalizar-checkout");
  const inputCep = document.getElementById("cep-checkout");

  function linhaResumo() {
    const r = resumoCarrinhoAtual();
    containerItens.innerHTML = "";
    r.carrinho.forEach((item) => {
      const t = item.tamanho ? ` · ${item.tamanho}` : "";
      const p = document.createElement("p");
      p.innerHTML = `<span>${item.nome}${t} x${item.quantidade}</span><strong>${item.preco}</strong>`;
      containerItens.appendChild(p);
    });
    return r;
  }

  function getCep8() {
    return (inputCep?.value || "").replace(/\D/g, "");
  }

  function pintarTotais() {
    const r = resumoCarrinhoAtual();
    if (subtotalEl) subtotalEl.textContent = formatarMoeda(r.subtotal);
    if (descontoEl) descontoEl.textContent = `- ${formatarMoeda(r.discount || 0)}`;
    if (freteEl) {
      if (!r.freteOpcaoId) freteEl.textContent = "A definir";
      else freteEl.textContent = formatarMoeda(r.shipping || 0);
    }
    if (totalEl) totalEl.textContent = formatarMoeda(r.total);
  }

  function podePagarAgora() {
    const r = resumoCarrinhoAtual();
    if (!r.carrinho.length) return false;
    const c = getCep8();
    const rCep = String(r.freteCep || "").replace(/\D/g, "");
    if (c.length !== 8 || rCep !== c || !r.freteOpcaoId) return false;
    return true;
  }

  function mensagemBloqueioPagar() {
    const r = resumoCarrinhoAtual();
    if (!r.carrinho.length) return "Carrinho vazio.";
    if (getCep8().length !== 8) return "Informe o CEP com 8 dígitos.";
    if (String(r.freteCep || "").replace(/\D/g, "") !== getCep8()) return "Clique em Buscar CEP (ou saia do campo) para buscar o endereço e o frete.";
    if (!r.freteOpcaoId) return "Selecione uma opção de entrega abaixo do CEP.";
    return "";
  }

  function atualizarBotaoPagar() {
    pintarTotais();
    const ok = podePagarAgora();
    if (btnPagar) {
      btnPagar.disabled = !ok;
      btnPagar.title = ok ? "" : mensagemBloqueioPagar() || "Complete CEP e frete para pagar.";
    }
    if (avisoFrete) avisoFrete.style.display = ok ? "none" : "block";
  }

  linhaResumo();
  atualizarBotaoPagar();

  const sugCep = localStorage.getItem(CEP_FRETE_SUGESTAO) || "";
  const rSalvo = lerResumoCarrinho();
  if (inputCep) {
    if (rSalvo.freteCep && rSalvo.freteCep.length === 8) {
      inputCep.value = rSalvo.freteCep.replace(/(\d{5})(\d{3})/, "$1-$2");
    } else if (sugCep && sugCep.length === 8) {
      inputCep.value = sugCep.replace(/(\d{5})(\d{3})/, "$1-$2");
    }
  }

  if (rSalvo.freteCep && rSalvo.freteOpcaoId && hostFrete) {
    (async () => {
      const p = (await buscarOpcoesFrete(rSalvo.freteCep)) || opcoesFreteLocal(rSalvo.freteCep);
      if (p?.opcoes) {
        hostFrete.style.display = "flex";
        if (notaFrete) notaFrete.style.display = "block";
        renderRadiosFrete(
          p.opcoes,
          "freteCheckout",
          rSalvo.freteOpcaoId,
          (o) => {
            aplicarOpcaoNoResumo(rSalvo.freteCep, o);
            atualizarBotaoPagar();
          },
          hostFrete
        );
        atualizarBotaoPagar();
      }
    })();
  }

  apiFetch("/api/me")
    .then((data) => {
      if (!data.user) return;
      const u = data.user;
      if (!document.getElementById("nome-checkout")?.value) document.getElementById("nome-checkout").value = u.name || "";
      if (!document.getElementById("email-checkout")?.value) document.getElementById("email-checkout").value = u.email || "";
      if (!document.getElementById("telefone-checkout")?.value) document.getElementById("telefone-checkout").value = u.phone || "";
      const preLog = document.getElementById("logradouro-checkout")?.value;
      if (!preLog && u.address_street) document.getElementById("logradouro-checkout").value = u.address_street || "";
      if (!document.getElementById("numero-checkout")?.value && u.address_number) {
        document.getElementById("numero-checkout").value = u.address_number;
      }
      if (!document.getElementById("complemento-checkout")?.value && u.address_complement) {
        document.getElementById("complemento-checkout").value = u.address_complement;
      }
      if (!document.getElementById("bairro-checkout")?.value && u.address_neighborhood) {
        document.getElementById("bairro-checkout").value = u.address_neighborhood;
      }
      if (!document.getElementById("cidade-checkout")?.value && u.address_city) {
        document.getElementById("cidade-checkout").value = u.address_city;
      }
      if (!document.getElementById("uf-checkout")?.value && u.address_state) {
        document.getElementById("uf-checkout").value = String(u.address_state).toUpperCase().slice(0, 2);
      }
      const z = document.getElementById("cep-checkout");
      if (z && u.zip_code && !z.value) {
        z.value = String(u.zip_code).replace(/\D/g, "").length === 8
          ? String(u.zip_code).replace(/\D/g, "").replace(/(\d{5})(\d{3})/, "$1-$2")
          : String(u.zip_code);
      }
    })
    .catch(() => {});

  form.addEventListener("submit", (e) => e.preventDefault());

  inputCep?.addEventListener("input", () => {
    const c = getCep8();
    const r = lerResumoCarrinho();
    const rCep = String(r.freteCep || "").replace(/\D/g, "");
    if (r.freteOpcaoId && c !== rCep) {
      const { discount } = r;
      salvarStorage(CHECKOUT_RESUMO_CHAVE, { ...RESUMO_FRETE_VAZIO, discount: discount || 0 });
      if (hostFrete) {
        hostFrete.style.display = "none";
        hostFrete.innerHTML = "";
      }
      if (notaFrete) notaFrete.style.display = "none";
    }
    atualizarBotaoPagar();
  });

  async function buscarCepCheckout() {
    const raw = getCep8();
    if (raw.length !== 8) {
      if (feedback) feedback.textContent = "CEP: informe 8 dígitos e use Buscar CEP (ou saia do campo).";
      return;
    }
    let fr = null;
    try {
      const d = await apiFetch(`/api/cep/${raw}`);
      const log = document.getElementById("logradouro-checkout");
      const bairro = document.getElementById("bairro-checkout");
      const cid = document.getElementById("cidade-checkout");
      const uf = document.getElementById("uf-checkout");
      const zip = document.getElementById("cep-checkout");
      if (d.address_street && log) log.value = d.address_street;
      if (d.address_neighborhood && bairro) bairro.value = d.address_neighborhood;
      if (d.address_city && cid) cid.value = d.address_city;
      if (d.address_state && uf) uf.value = String(d.address_state).toUpperCase().slice(0, 2);
      if (d.zip_code && zip) {
        const z0 = String(d.zip_code).replace(/\D/g, "");
        zip.value = z0.length === 8 ? z0.replace(/(\d{5})(\d{3})/, "$1-$2") : d.zip_code;
      }
      localStorage.setItem(CEP_FRETE_SUGESTAO, raw);
      fr = (await buscarOpcoesFrete(raw)) || opcoesFreteLocal(raw);
      if (fr?.opcoes && hostFrete) {
        const r2 = lerResumoCarrinho();
        const r2Cep = String(r2.freteCep || "").replace(/\D/g, "");
        const jaOk = r2Cep === raw && r2.freteOpcaoId;
        const sel = jaOk ? r2.freteOpcaoId : null;
        if (!jaOk) {
          const { discount } = r2;
          salvarStorage(CHECKOUT_RESUMO_CHAVE, { ...RESUMO_FRETE_VAZIO, discount: discount || 0 });
        }
        hostFrete.style.display = "flex";
        if (notaFrete) notaFrete.style.display = "block";
        renderRadiosFrete(
          fr.opcoes,
          "freteCheckout",
          sel,
          (o) => {
            aplicarOpcaoNoResumo(raw, o);
            atualizarBotaoPagar();
          },
          hostFrete
        );
        if (feedback) feedback.textContent = "Endereço e opções de frete. Escolha a entrega.";
      }
      if (feedback && !fr?.opcoes) feedback.textContent = "CEP localizado, mas o frete não pôde ser listado. Tente de novo.";
    } catch (e) {
      if (feedback) feedback.textContent = e.message;
    }
    atualizarBotaoPagar();
  }

  document.getElementById("btn-cep-checkout")?.addEventListener("click", buscarCepCheckout);
  document.getElementById("cep-checkout")?.addEventListener("blur", () => {
    if (getCep8().length === 8) buscarCepCheckout();
  });

  document.getElementById("btn-finalizar-checkout")?.addEventListener("click", async () => {
    if (!podePagarAgora()) {
      if (feedback) {
        feedback.textContent = mensagemBloqueioPagar() || "Preencha o CEP, o frete e tente de novo.";
      }
      return;
    }
    const r = resumoCarrinhoAtual();
    if (!r.carrinho.length) {
      if (feedback) feedback.textContent = "Seu carrinho está vazio.";
      return;
    }
    const log = (document.getElementById("logradouro-checkout")?.value || "").trim();
    const num = (document.getElementById("numero-checkout")?.value || "").trim();
    const comp = (document.getElementById("complemento-checkout")?.value || "").trim();
    const bairro = (document.getElementById("bairro-checkout")?.value || "").trim();
    const cidade = (document.getElementById("cidade-checkout")?.value || "").trim();
    const uf = (document.getElementById("uf-checkout")?.value || "").trim().toUpperCase().slice(0, 2);
    if (!log || !num || !bairro || !cidade || !uf) {
      if (feedback) {
        feedback.textContent = "Preencha logradouro, número, bairro, cidade e UF (após o CEP).";
      }
      return;
    }
    const nome = (document.getElementById("nome-checkout")?.value || "").trim();
    const email = (document.getElementById("email-checkout")?.value || "").trim();
    if (!nome || !email) {
      if (feedback) feedback.textContent = "Preencha nome completo e e-mail.";
      return;
    }

    const linha1 = [log, num].filter(Boolean).join(", ");
    const partesEnd = [linha1, comp, bairro].filter(Boolean);
    const address = partesEnd.join(" — ");
    const city = [cidade, uf].filter(Boolean).join(" - ");
    const itemsPayload = r.carrinho.map((item) => ({
      id: item.id,
      nome: item.nome,
      preco: item.preco,
      quantidade: item.quantidade,
      tamanho: item.tamanho || "Único",
    }));
    const payload = {
      customer_name: nome,
      customer_email: email,
      customer_phone: document.getElementById("telefone-checkout")?.value || "",
      address,
      city,
      zip_code: getCep8() || (document.getElementById("cep-checkout")?.value || "").replace(/\D/g, ""),
      payment_method: document.getElementById("pagamento-checkout")?.value || "Pix",
      subtotal: r.subtotal,
      discount: r.discount || 0,
      shipping: r.shipping || 0,
      total: r.total,
      items: itemsPayload,
    };
    try {
      const data = await apiFetch("/api/orders", { method: "POST", body: JSON.stringify(payload) });
      const urlMp =
        (data.mercadopago && (data.mercadopago.redirect_url || data.mercadopago.sandbox_init_point || data.mercadopago.init_point)) || "";
      if (urlMp) {
        salvarCarrinho([]);
        salvarStorage(CHECKOUT_RESUMO_CHAVE, { ...RESUMO_FRETE_VAZIO });
        if (feedback) feedback.textContent = "Redirecionando para o pagamento seguro…";
        window.location.href = urlMp;
        return;
      }
      if (data.mercadopago_error) {
        salvarCarrinho([]);
        salvarStorage(CHECKOUT_RESUMO_CHAVE, { ...RESUMO_FRETE_VAZIO });
        if (feedback) {
          feedback.innerHTML = `${data.mercadopago_error} Pedido #${data.order_id} fica em <strong>aguardando pagamento</strong>. <a href="minha-conta.html">Abrir Minha Conta</a> ou tente de novo após configurar o Mercado Pago.`;
        }
        return;
      }
      if (feedback) feedback.textContent = `Pedido #${data.order_id} registrado. Acompanhe em Minha Conta.`;
      salvarCarrinho([]);
      salvarStorage(CHECKOUT_RESUMO_CHAVE, { ...RESUMO_FRETE_VAZIO });
      window.setTimeout(() => {
        window.location.href = "minha-conta.html";
      }, 1200);
    } catch (error) {
      if (feedback) feedback.textContent = error.message;
    }
  });
}

function iniciarLightboxGaleria(containerSelector) {
  const box = document.getElementById("lightbox-produto");
  if (!box) return;
  const mainImg = box.querySelector(".lightbox-foto");
  const btnPrev = box.querySelector(".lightbox-prev");
  const btnNext = box.querySelector(".lightbox-next");
  const dialog = box.querySelector(".lightbox-dialog");
  let urls = [];
  let index = 0;

  function atualizarImagem() {
    if (!mainImg || !urls.length) return;
    mainImg.classList.remove("lightbox-foto--zoom");
    mainImg.src = urls[index];
  }

  function abrir(clickedImg) {
    const imgs = document.querySelectorAll(`${containerSelector} img`);
    urls = Array.from(imgs)
      .map((g) => (g.currentSrc || g.src || "").trim())
      .filter((u) => u);
    if (!urls.length) return;
    const more = urls.length > 1;
    if (btnPrev) btnPrev.hidden = !more;
    if (btnNext) btnNext.hidden = !more;
    index = 0;
    if (clickedImg && imgs.length) {
      const j = Array.from(imgs).indexOf(clickedImg);
      if (j >= 0) index = j;
    }
    box.hidden = false;
    document.body.classList.add("lightbox-open");
    atualizarImagem();
  }

  function fechar() {
    box.hidden = true;
    document.body.classList.remove("lightbox-open");
    if (mainImg) mainImg.classList.remove("lightbox-foto--zoom");
  }

  function prox() {
    if (urls.length <= 1) return;
    index = (index + 1) % urls.length;
    atualizarImagem();
  }

  function ant() {
    if (urls.length <= 1) return;
    index = (index - 1 + urls.length) % urls.length;
    atualizarImagem();
  }

  document.querySelectorAll(`${containerSelector} img`).forEach((img) => {
    img.addEventListener("click", (e) => {
      e.preventDefault();
      abrir(e.currentTarget);
    });
  });

  mainImg?.addEventListener("click", (e) => e.stopPropagation());
  mainImg?.addEventListener("dblclick", (e) => {
    e.preventDefault();
    e.stopPropagation();
    mainImg.classList.toggle("lightbox-foto--zoom");
  });

  box.querySelectorAll("[data-lightbox-close]").forEach((el) => {
    el.addEventListener("click", () => fechar());
  });
  btnNext?.addEventListener("click", (e) => {
    e.stopPropagation();
    prox();
  });
  btnPrev?.addEventListener("click", (e) => {
    e.stopPropagation();
    ant();
  });
  dialog?.addEventListener("click", (e) => e.stopPropagation());

  document.addEventListener("keydown", (e) => {
    if (box.hidden) return;
    if (e.key === "Escape") fechar();
    if (e.key === "ArrowRight") prox();
    if (e.key === "ArrowLeft") ant();
  });
}

function alternarVisibilidadeSenha(inputId) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.type = input.type === "password" ? "text" : "password";
  const wrap = input.closest(".campo-senha-wrap");
  const btn = wrap?.querySelector(".btn-toggle-senha-olho");
  const aberto = wrap?.querySelector(".eh-olho-aberto");
  const riscado = wrap?.querySelector(".eh-olho-riscado");
  const mostrando = input.type === "text";
  if (btn) {
    const label = mostrando ? "Ocultar senha" : "Mostrar senha";
    btn.setAttribute("aria-label", label);
    btn.setAttribute("title", label);
    btn.setAttribute("aria-pressed", mostrando ? "true" : "false");
  }
  if (aberto && riscado) {
    if (mostrando) {
      aberto.setAttribute("hidden", "");
      riscado.removeAttribute("hidden");
    } else {
      riscado.setAttribute("hidden", "");
      aberto.removeAttribute("hidden");
    }
  }
}

async function iniciarCadastroEndereco() {
  const form = document.getElementById("form-cadastro");
  if (!form) return;
  const btnCep = document.getElementById("btn-buscar-cep");
  const feedback = document.getElementById("cadastro-feedback");
  const cepInput = document.getElementById("cep-cadastro");

  document.getElementById("btn-toggle-senha-1")?.addEventListener("click", () => alternarVisibilidadeSenha("senha-cadastro"));
  document.getElementById("btn-toggle-senha-2")?.addEventListener("click", () => alternarVisibilidadeSenha("senha-cadastro-2"));

  const buscarCepCadastro = async () => {
    const cep = (cepInput?.value || "").replace(/\D/g, "");
    if (cep.length !== 8) {
      if (feedback) feedback.textContent = "CEP com 8 dígitos, por favor.";
      return;
    }
    try {
      const d = await apiFetch(`/api/cep/${cep}`);
      if (d.address_street) document.getElementById("logradouro-cadastro").value = d.address_street;
      if (d.address_neighborhood) document.getElementById("bairro-cadastro").value = d.address_neighborhood;
      if (d.address_city) document.getElementById("cidade-cadastro").value = d.address_city;
      if (d.address_state) {
        document.getElementById("uf-cadastro").value = String(d.address_state).toUpperCase().slice(0, 2);
      }
    } catch (e) {
      if (feedback) feedback.textContent = e.message;
    }
  };

  btnCep?.addEventListener("click", buscarCepCadastro);
  cepInput?.addEventListener("blur", () => {
    if ((cepInput?.value || "").replace(/\D/g, "").length === 8) buscarCepCadastro();
  });

  const feedbackCadastro = document.getElementById("cadastro-feedback");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const s1 = document.getElementById("senha-cadastro")?.value || "";
    const s2 = document.getElementById("senha-cadastro-2")?.value || "";
    if (s1 !== s2) {
      feedbackCadastro.textContent = "As senhas não coincidem.";
      return;
    }
    const payload = {
      name: document.getElementById("nome-cadastro")?.value || "",
      email: document.getElementById("email-cadastro")?.value || "",
      password: s1,
      phone: document.getElementById("telefone-cadastro")?.value || "",
      zip_code: (document.getElementById("cep-cadastro")?.value || "").replace(/\D/g, ""),
      address_street: document.getElementById("logradouro-cadastro")?.value || "",
      address_number: document.getElementById("numero-cadastro")?.value || "",
      address_neighborhood: document.getElementById("bairro-cadastro")?.value || "",
      address_city: document.getElementById("cidade-cadastro")?.value || "",
      address_state: (document.getElementById("uf-cadastro")?.value || "").toUpperCase().slice(0, 2),
      address_complement: document.getElementById("complemento-cadastro")?.value || "",
    };
    if (payload.zip_code.length !== 8) {
      feedbackCadastro.textContent = "Informe um CEP válido.";
      return;
    }
    try {
      await apiFetch("/api/register", { method: "POST", body: JSON.stringify(payload) });
      feedbackCadastro.textContent =
        "Conta criada com sucesso. Redirecionando... (Com SMTP configurado no servidor, enviamos e-mail de boas-vindas.)";
      window.setTimeout(() => {
        window.location.href = "minha-conta.html";
      }, 1000);
    } catch (err) {
      feedbackCadastro.textContent = err.message;
    }
  });
}

async function iniciarAutenticacao() {
  const formLogin = document.getElementById("form-login");
  const feedbackLogin = document.getElementById("login-feedback");
  if (formLogin && feedbackLogin) {
    document.getElementById("btn-toggle-senha-login")?.addEventListener("click", () => alternarVisibilidadeSenha("senha-login"));
    formLogin.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const email = document.getElementById("email-login")?.value || "";
      const password = document.getElementById("senha-login")?.value || "";
      try {
        await apiFetch("/api/login", { method: "POST", body: JSON.stringify({ email, password }) });
        feedbackLogin.textContent = "Login realizado com sucesso. Redirecionando...";
        window.setTimeout(() => {
          window.location.href = "minha-conta.html";
        }, 600);
      } catch (error) {
        feedbackLogin.textContent = error.message;
      }
    });
  }

  await iniciarCadastroEndereco();

  const contaNome = document.getElementById("conta-nome");
  const contaEmail = document.getElementById("conta-email");
  const contaTelefone = document.getElementById("conta-telefone");
  const enderecoConta = document.getElementById("conta-endereco");
  if (contaNome && contaEmail && contaTelefone) {
    try {
      const { user } = await apiFetch("/api/me");
      if (user) {
        contaNome.textContent = user.name || "-";
        contaEmail.textContent = user.email || "-";
        contaTelefone.textContent = user.phone || "-";
        if (enderecoConta) {
          const partes = [
            user.zip_code,
            user.address_street,
            user.address_number,
            user.address_complement,
            user.address_neighborhood,
            [user.address_city, user.address_state].filter(Boolean).join("/"),
          ].filter(Boolean);
          enderecoConta.innerHTML = partes.length ? partes.map((l) => `<li>${l}</li>`).join("") : "<li>Endereço não cadastrado.</li>";
        }
      } else {
        contaNome.textContent = "Visitante";
        if (enderecoConta) enderecoConta.innerHTML = "<li>Faça login para ver o endereço.</li>";
      }
    } catch {
      contaNome.textContent = "Visitante";
    }
  }

  const listaPedidos = document.getElementById("lista-pedidos");
  const btnHistorico = document.getElementById("btn-historico-pedidos");
  if (listaPedidos) {
    try {
      const data = await apiFetch("/api/orders?limit=20");
      renderLinhasPedidos(data.orders, listaPedidos);
      if (btnHistorico) {
        const tem = data.orders?.length > 0;
        btnHistorico.style.display = tem ? "inline-block" : "none";
        btnHistorico.addEventListener("click", async () => {
          const rótulo = btnHistorico.textContent;
          btnHistorico.disabled = true;
          btnHistorico.textContent = "Carregando…";
          try {
            const full = await apiFetch("/api/orders?limit=100");
            renderLinhasPedidos(full.orders, listaPedidos);
            btnHistorico.textContent = "Atualizar histórico";
            document.getElementById("secao-pedidos")?.scrollIntoView({ behavior: "smooth" });
          } catch (e) {
            btnHistorico.textContent = rótulo;
            alert(e.message || "Não foi possível carregar o histórico.");
          } finally {
            btnHistorico.disabled = false;
          }
        });
      }
    } catch {
      listaPedidos.innerHTML = "<li>Faça login para ver seus pedidos.</li>";
      if (btnHistorico) btnHistorico.style.display = "none";
    }
  }

  document.getElementById("btn-logout")?.addEventListener("click", async () => {
    try {
      await apiFetch("/api/logout", { method: "POST" });
    } finally {
      window.location.href = "login.html";
    }
  });
}

async function iniciarAplicacao() {
  inserirAtalhoCarrinhoNoTopo();
  iniciarMenuLateral();
  await carregarProdutosDoBanco();
  popularOpcoesFiltroCor();
  const params = new URLSearchParams(window.location.search);
  if (params.get("categoria")) {
    filtroCategoria = params.get("categoria");
  }
  if (window.location.pathname.includes("catalogo.html") || document.getElementById("catalogo")) {
    document.querySelectorAll("#filtros-categoria [data-cat]").forEach((btn) => {
      const v = btn.getAttribute("data-cat") || "";
      btn.classList.toggle("ativo", v === filtroCategoria);
    });
  }
  if (document.getElementById("novidades")) {
    const container = document.getElementById("novidades");
    container.innerHTML = "";
    filtrarLista(produtos)
      .slice(0, 4)
      .forEach((p) => container.appendChild(criarCardLista(p)));
    configurarBotoesCarrinho();
  }
  if (document.getElementById("catalogo")) {
    renderizarCatalogo();
    iniciarFiltrosCatalogo();
  }
  renderizarFavoritos();
  configurarBotoesFavoritos();
  atualizarResumoFavoritos();
  iniciarPaginaCarrinho();
  iniciarCheckout();
  if (window.location.pathname.includes("produto.html")) {
    await iniciarPaginaProduto();
  }
  await iniciarAutenticacao();
}

iniciarAplicacao();
