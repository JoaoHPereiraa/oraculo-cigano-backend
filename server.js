// Adicionar no início do arquivo, logo após as importações
process.on('uncaughtException', (error) => {
    console.error('=== ERRO NÃO TRATADO ===');
    console.error('Tipo:', error.name);
    console.error('Mensagem:', error.message);
    console.error('Stack:', error.stack);
    console.error('=======================');
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('=== PROMESSA REJEITADA NÃO TRATADA ===');
    console.error('Razão:', reason);
    console.error('Promise:', promise);
    console.error('=====================================');
});

// Configurações padrão caso o .env não esteja disponível
const DEFAULT_CONFIG = {
    PORT: 3001,
    GEMINI_API_KEY: 'YOUR_API_KEY_HERE', // Placeholder - será substituído pela variável de ambiente
    MAX_REQUESTS_PER_MINUTE: 1, // Alterado para 1 requisição por minuto
    REQUEST_DELAY: 250,
    MAX_TOKENS: 1024,
    TEMPERATURE: 0.7
};

// Tentar carregar o .env, mas não falhar se não existir
try {
    require('dotenv').config();
    console.log('Arquivo .env carregado com sucesso');
} catch (error) {
    console.log('Arquivo .env não encontrado, usando configurações padrão');
}

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const fetch = require('node-fetch');
const http = require('http');
const path = require('path');
const helmet = require('helmet');

// Log inicial para debug
console.log('Diretório atual:', process.cwd());
console.log('Tentando carregar .env de:', path.resolve(process.cwd(), '.env'));
console.log('Variáveis de ambiente carregadas:', {
    PORT: process.env.PORT,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY ? 'Definida' : 'Não definida',
    MAX_REQUESTS_PER_MINUTE: process.env.MAX_REQUESTS_PER_MINUTE,
    REQUEST_DELAY: process.env.REQUEST_DELAY,
    MAX_TOKENS: process.env.MAX_TOKENS,
    TEMPERATURE: process.env.TEMPERATURE
});

// Configurações do servidor
const config = {
    PORT: process.env.PORT || DEFAULT_CONFIG.PORT,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || DEFAULT_CONFIG.GEMINI_API_KEY,
    MAX_REQUESTS_PER_MINUTE: parseInt(process.env.MAX_REQUESTS_PER_MINUTE) || DEFAULT_CONFIG.MAX_REQUESTS_PER_MINUTE,
    REQUEST_DELAY: parseInt(process.env.REQUEST_DELAY) || DEFAULT_CONFIG.REQUEST_DELAY,
    MAX_TOKENS: parseInt(process.env.MAX_TOKENS) || DEFAULT_CONFIG.MAX_TOKENS,
    TEMPERATURE: parseFloat(process.env.TEMPERATURE) || DEFAULT_CONFIG.TEMPERATURE
};

// Log das configurações carregadas
console.log('=== Configurações do Servidor ===');
console.log('Porta:', config.PORT);
console.log('API Key:', config.GEMINI_API_KEY ? '✅ Definida' : '❌ Não definida');
console.log('Rate Limit:', config.MAX_REQUESTS_PER_MINUTE, 'requisições/minuto');
console.log('Delay entre requisições:', config.REQUEST_DELAY, 'ms');
console.log('Max Tokens:', config.MAX_TOKENS);
console.log('Temperature:', config.TEMPERATURE);
console.log('==============================');

const app = express();
let server = null;

// Configurações de segurança para produção
const corsOptions = {
    origin: process.env.NODE_ENV === 'production'
        ? ['https://joaohpereiraa.github.io'] // Domínio correto do GitHub Pages
        : ['http://localhost:*', 'http://127.0.0.1:*'],
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
    credentials: true
};

// Middleware
app.use(helmet()); // Adiciona headers de segurança
app.use(cors(corsOptions));
app.use(express.json({ limit: '10kb' })); // Limita tamanho do payload

// Middleware de logging melhorado
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    const requestId = Math.random().toString(36).substring(7);
    console.log(`[${timestamp}] [${requestId}] ${req.method} ${req.path}`);
    console.log(`[${requestId}] Headers:`, req.headers);
    console.log(`[${requestId}] Body:`, req.body);

    // Adiciona o ID da requisição para rastreamento
    req.requestId = requestId;

    // Monitora o tempo de resposta
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`[${timestamp}] [${requestId}] ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
    });

    next();
});

// Configuração do rate limiting
const limiter = rateLimit({
    windowMs: 60 * 1000, // 1 minuto
    max: 1, // 1 requisição por minuto
    message: {
        error: 'Por favor, aguarde 1 minuto antes de fazer uma nova leitura.',
        retryAfter: 60
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        // Usa o IP do cliente como chave para o rate limiting
        return req.ip;
    }
});

// Aplicar o rate limiter apenas na rota de interpretação
app.use('/api/interpretacao', limiter);

// Função para validar os dados de entrada
function validarDadosEntrada(carta1, carta2, tempo, tema) {
    const cartasValidas = [
        "O Cavaleiro", "O Trevo", "O Navio", "A Casa", "A Árvore", "As Nuvens", "A Serpente", "O Caixão",
        "O Buquê", "A Foice", "O Chicote", "Os Pássaros", "A Criança", "A Raposa", "O Urso", "A Estrela",
        "A Cegonha", "O Cachorro", "A Torre", "O Jardim", "A Montanha", "Os Caminhos", "Os Ratos", "O Coração",
        "O Anel", "O Livro", "A Carta", "O Homem", "A Mulher", "Os Lírios", "O Sol", "A Lua", "A Chave",
        "Os Peixes", "A Âncora", "A Cruz"
    ];

    const temposValidos = ["Passado", "Presente", "Futuro"];
    const temasValidos = ["Espiritual", "Mental", "Amor", "Saúde", "Profissional", "Financeiro"];

    const erros = [];

    if (!carta1 || !cartasValidas.includes(carta1)) {
        erros.push(`Carta1 inválida: ${carta1}`);
    }
    if (!carta2 || !cartasValidas.includes(carta2)) {
        erros.push(`Carta2 inválida: ${carta2}`);
    }
    if (!tempo || !temposValidos.includes(tempo)) {
        erros.push(`Tempo inválido: ${tempo}`);
    }
    if (!tema || !temasValidos.includes(tema)) {
        erros.push(`Tema inválido: ${tema}`);
    }

    return erros;
}

// Endpoint para verificar status do servidor
app.get('/api/status', (req, res) => {
    const response = {
        status: 'online',
        timestamp: new Date().toISOString(),
        port: server?.address()?.port || config.PORT,
        environment: process.env.NODE_ENV || 'development'
    };

    // Adiciona informações extras apenas em desenvolvimento
    if (process.env.NODE_ENV !== 'production') {
        response.config = {
            rateLimit: config.MAX_REQUESTS_PER_MINUTE,
            requestDelay: config.REQUEST_DELAY,
            maxTokens: config.MAX_TOKENS,
            temperature: config.TEMPERATURE
        };
    }

    res.json(response);
});

// Adicionar antes do endpoint /api/interpretacao
app.get('/api/test', (req, res) => {
    res.json({
        message: 'Backend está funcionando!',
        timestamp: new Date().toISOString(),
        port: server?.address()?.port || config.PORT
    });
});

// Endpoint para gerar interpretações
app.post('/api/interpretacao', async (req, res) => {
    const requestId = req.requestId;
    try {
        const { carta1, carta2, tempo, tema } = req.body;
        console.log(`[${requestId}] Iniciando interpretação para:`, { carta1, carta2, tempo, tema });

        // Validar dados de entrada
        const erros = validarDadosEntrada(carta1, carta2, tempo, tema);
        if (erros.length > 0) {
            console.error(`[${requestId}] Erro de validação:`, erros);
            return res.status(400).json({
                error: 'Dados inválidos',
                detalhes: erros,
                requestId
            });
        }

        console.log(`[${requestId}] Gerando interpretação para: ${carta1} + ${carta2} (${tempo}, ${tema})`);

        const prompt = `Como especialista em baralho cigano, interprete a combinação das cartas "${carta1}" e "${carta2}" no âmbito ${tema.toLowerCase()} para o tempo ${tempo.toLowerCase()}. 
        Forneça uma interpretação detalhada e significativa, incluindo:
        1. O significado geral da combinação
        2. Como isso se aplica especificamente ao tema ${tema.toLowerCase()}
        3. O que isso indica para o ${tempo.toLowerCase()}
        Mantenha a interpretação clara e objetiva.`;

        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${config.GEMINI_API_KEY}`;

        try {
            console.log(`[${requestId}] Chamando API Gemini...`);
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    contents: [{
                        parts: [{
                            text: prompt
                        }]
                    }],
                    generationConfig: {
                        temperature: config.TEMPERATURE,
                        maxOutputTokens: config.MAX_TOKENS,
                        topP: 0.8,
                        topK: 40
                    },
                    safetySettings: [
                        {
                            category: "HARM_CATEGORY_HARASSMENT",
                            threshold: "BLOCK_MEDIUM_AND_ABOVE"
                        },
                        {
                            category: "HARM_CATEGORY_HATE_SPEECH",
                            threshold: "BLOCK_MEDIUM_AND_ABOVE"
                        },
                        {
                            category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                            threshold: "BLOCK_MEDIUM_AND_ABOVE"
                        },
                        {
                            category: "HARM_CATEGORY_DANGEROUS_CONTENT",
                            threshold: "BLOCK_MEDIUM_AND_ABOVE"
                        }
                    ]
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                console.error(`[${requestId}] Erro na API Gemini:`, {
                    status: response.status,
                    statusText: response.statusText,
                    error: errorData
                });
                throw new Error(`Erro na API Gemini: ${response.status} - ${errorData.error?.message || 'Erro desconhecido'}`);
            }

            const data = await response.json();
            console.log(`[${requestId}] Resposta da API Gemini recebida`);

            if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
                throw new Error('Resposta da API inválida');
            }

            // Adiciona um pequeno delay entre requisições
            await new Promise(resolve => setTimeout(resolve, config.REQUEST_DELAY));

            const interpretacao = data.candidates[0].content.parts[0].text.trim();
            console.log(`[${requestId}] Interpretação gerada com sucesso para: ${carta1} + ${carta2}`);

            res.json({
                interpretacao,
                requestId,
                timestamp: new Date().toISOString()
            });

        } catch (apiError) {
            console.error(`[${requestId}] Erro na chamada à API Gemini:`, {
                error: apiError.message,
                stack: apiError.stack
            });
            throw new Error(`Erro ao comunicar com a API: ${apiError.message}`);
        }

    } catch (error) {
        console.error(`[${requestId}] Erro ao gerar interpretação:`, {
            error: error.message,
            stack: error.stack
        });
        res.status(500).json({
            error: `Erro ao gerar interpretação: ${error.message}`,
            requestId,
            timestamp: new Date().toISOString()
        });
    }
});

// Tratamento de erros global melhorado
app.use((err, req, res, next) => {
    const requestId = req.requestId || 'unknown';
    console.error(`[${requestId}] Erro não tratado:`, {
        error: err.message,
        stack: err.stack,
        path: req.path,
        method: req.method,
        body: req.body,
        headers: req.headers
    });
    res.status(500).json({
        error: 'Erro interno do servidor',
        message: err.message,
        requestId,
        timestamp: new Date().toISOString()
    });
});

// Adicionar no início do arquivo, após as importações
const PORTAS_DISPONIVEIS = [3000, 3001, 3002, 3003, 3004, 3005];

// Modificar a função iniciarServidor
function iniciarServidor(portaInicial) {
    return new Promise((resolve, reject) => {
        const tentarProximaPorta = (portaAtual) => {
            const proximaPorta = PORTAS_DISPONIVEIS.find(p => p > portaAtual);
            if (!proximaPorta) {
                reject(new Error('Nenhuma porta disponível encontrada'));
                return;
            }
            console.log(`\nTentando próxima porta disponível: ${proximaPorta}`);
            iniciarServidor(proximaPorta).then(resolve).catch(reject);
        };

        try {
            console.log('\n=== TENTANDO INICIAR SERVIDOR ===');
            console.log('Tentando porta:', portaInicial);
            server = http.createServer(app);

            server.on('error', (error) => {
                console.error('\n=== ERRO AO INICIAR SERVIDOR ===');
                console.error('Código:', error.code);
                console.error('Mensagem:', error.message);
                console.error('Porta tentada:', portaInicial);

                if (error.code === 'EADDRINUSE') {
                    console.log(`\nPorta ${portaInicial} em uso, tentando próxima porta...`);
                    tentarProximaPorta(portaInicial);
                } else {
                    reject(error);
                }
            });

            server.on('listening', () => {
                const portaAtual = server.address().port;
                console.log('\n=== SERVIDOR INICIADO COM SUCESSO ===');
                console.log('Porta atual:', portaAtual);
                console.log('URL do servidor:', `http://localhost:${portaAtual}`);
                console.log('Teste de conexão:', `http://localhost:${portaAtual}/api/test`);
                console.log('Status do servidor:', `http://localhost:${portaAtual}/api/status`);
                console.log('====================================\n');
                resolve(server);
            });

            server.listen(portaInicial);
        } catch (error) {
            console.error('\n=== ERRO FATAL AO CRIAR SERVIDOR ===');
            console.error('Erro:', error.message);
            console.error('Stack:', error.stack);
            reject(error);
        }
    });
}

// Modificar a inicialização do servidor
try {
    console.log('=== INICIANDO APLICAÇÃO ===');
    console.log('Diretório:', process.cwd());
    console.log('Node version:', process.version);
    console.log('Plataforma:', process.platform);
    console.log('Portas disponíveis:', PORTAS_DISPONIVEIS.join(', '));
    console.log('==========================');

    // Tenta iniciar com a primeira porta disponível
    iniciarServidor(PORTAS_DISPONIVEIS[0]).catch(error => {
        console.error('=== ERRO FATAL AO INICIAR SERVIDOR ===');
        console.error('Erro:', error.message);
        console.error('Stack:', error.stack);
        console.error('=====================================');
        process.exit(1);
    });
} catch (error) {
    console.error('=== ERRO FATAL NA INICIALIZAÇÃO ===');
    console.error('Erro:', error.message);
    console.error('Stack:', error.stack);
    console.error('==================================');
    process.exit(1);
}

// Tratamento de encerramento gracioso
process.on('SIGTERM', () => {
    console.log('Recebido SIGTERM. Encerrando servidor...');
    if (server) {
        server.close(() => {
            console.log('Servidor encerrado.');
            process.exit(0);
        });
    }
});

process.on('SIGINT', () => {
    console.log('Recebido SIGINT. Encerrando servidor...');
    if (server) {
        server.close(() => {
            console.log('Servidor encerrado.');
            process.exit(0);
        });
    }
}); 