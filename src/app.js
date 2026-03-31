import 'dotenv/config'
import qrcode from 'qrcode-terminal'
import { createBot, createProvider, createFlow, addKeyword, EVENTS } from '@builderbot/bot'
import { MemoryDB as Database } from '@builderbot/bot'
import { BaileysProvider as Provider } from '@builderbot/provider-baileys'
import googleSheetService from './sheets.js'
import groqService from './ai-chat.js'
import chatHistoryService from './chat-history.js'
import scheduledMessageService from './scheduled-messages.js'

const PORT = process.env.PORT ?? 3008

// 🔥 NORMALIZAR TEXTO
const normalizeText = (text) => {
    return text
        .toLowerCase()
        .trim()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
}
const blockedUsers = new Map()
const dynamicFlow = addKeyword(EVENTS.WELCOME)
    .addAction(async (ctx, { flowDynamic, provider }) => {
        try {
            const flows = await googleSheetService.getFlows()

            const userInputRaw = ctx.body || ''
            const userInput = normalizeText(userInputRaw)
            const phoneNumber = ctx.from

            console.log(`📩 Mensaje recibido: ${userInputRaw}`)

               const now = Date.now()

            if (blockedUsers.has(phoneNumber)) {
            const unblockTime = blockedUsers.get(phoneNumber)

            if (now < unblockTime) {
             console.log("🚫 Usuario bloqueado temporalmente:", phoneNumber)
             return
                } else {
             // ⏳ ya expiró → lo eliminamos
                blockedUsers.delete(phoneNumber)
        console.log("✅ Usuario desbloqueado:", phoneNumber)
            }
}
            // 🚫 1. BLOQUEO DE PROMPT INJECTION / TROLL
            const forbiddenPatterns = [
                "ignora", "ignore", "actua como", "actúa como",
                "roleplay", "kawaii", "anime", "uwu", "senpai",
                "yamete", "daisuki", "amochito"
            ]

            if (forbiddenPatterns.some(p => userInput.includes(p))) {
                return await flowDynamic("Escribe 'planes' para ver opciones disponibles.")
            }

            // 🛑 2. DERIVACIÓN A ASESOR HUMANO
            if (
                userInput.includes('asesor') ||
                userInput.includes('humano') ||
                userInput.includes('persona')
            ) {
                console.log("👩‍💼 Cliente solicita asesor:", phoneNumber)

                await flowDynamic(` 
                    👉 Perfecto, un asesor te atenderá en breve.
                    📌 Te responderán por este mismo chat.
                    🛒 Mantente atento para continuar tu inscripción.`)

                blockedUsers.set(phoneNumber, Date.now() + 1800000)
                return
            }

            // 💰 3. DETECCIÓN DE PAGO (PRIORIDAD MÁXIMA)
            if (
                userInput.includes('ya pague') ||
                userInput.includes('ya pague') ||
                userInput.includes('ya yapie') ||
                userInput.includes('ya yapee') ||
                userInput.includes('pagado') ||
                userInput.includes('listo') ||
                userInput.includes('ya hice el pago') ||
                userInput.includes('ya transferi')
            ) {
                console.log("💰 Cliente pagó → pasar a humano:", phoneNumber)

                await flowDynamic(`     
                    👉 Perfecto, tu pago está en proceso de validación.
                    👉 Un asesor te atenderá en breve
                    📌 Envía tu captura + nombre completo + DNI + celular.
                    🛒 También puedes acercarte al gimnasio para activar tu acceso.`)

                blockedUsers.set(phoneNumber, Date.now() + 10000)
                
                return
            }

            // 🔍 4. BUSCAR FLUJO EN SHEETS
            const triggeredFlow = flows.find(f => {
                if (!f.addKeyword) return false

                const keywords = f.addKeyword
                    .split(',')
                    .map(k => normalizeText(k))

                return keywords.some(keyword => userInput.includes(keyword))
            })

            if (triggeredFlow) {
                console.log("✅ Flujo detectado:", triggeredFlow.addKeyword)

                const answer = triggeredFlow.addAnswer
                const mediaUrl = triggeredFlow.media?.trim()

                await chatHistoryService.saveMessage(phoneNumber, 'user', userInputRaw)
                await chatHistoryService.saveMessage(phoneNumber, 'assistant', answer)

                if (mediaUrl) {
                    await flowDynamic(answer, { media: mediaUrl })
                } else {
                    await flowDynamic(answer)
                }

                return
            }

            // 🤖 5. FALLBACK IA ULTRA CONTROLADO
            console.log('🤖 Usando IA controlada...')

            const aiResponse = await groqService.getResponse(userInputRaw, phoneNumber)

            const invalidPatterns = [
                "no puedo", "lo siento", "no estoy programado",
                "kawaii", "anime", "uwu", "senpai",
                "¿como estas?", "hablar contigo",
                "sucursales", "direcciones", "ofertas"
            ]

            let filteredResponse = aiResponse
                .replace(/\*.*?\*/g, '')
                .trim()

            const isInvalid = invalidPatterns.some(p =>
                filteredResponse.toLowerCase().includes(p)
            )

            if (isInvalid || filteredResponse.length > 200) {
                return await flowDynamic("Escribe 'planes' para ver opciones disponibles.")
            }

            await flowDynamic(filteredResponse)

        } catch (error) {
            console.error('❌ Error en dynamicFlow:', error)
            await flowDynamic("Escribe 'planes' para ver opciones disponibles.")
        }
    })

// 🚀 MAIN
    const main = async () => {
    await googleSheetService.getFlows()
    await googleSheetService.getPrompts()
    await googleSheetService.getScheduledMessages()

    setInterval(async () => {
        console.log('🧹 Limpiando historial...')
        await chatHistoryService.cleanOldHistories()
    }, 24 * 60 * 60 * 1000)

    const adapterFlow = createFlow([dynamicFlow])

    const adapterProvider = createProvider(Provider, {
        version: [2, 3000, 1035824857]
    })

    adapterProvider.on('qr', (qr) => {
        console.log('📱 ESCANEA ESTE QR:')
        qrcode.generate(qr, { small: true })
    })

    const adapterDB = new Database()

    const { handleCtx, httpServer } = await createBot({
        flow: adapterFlow,
        provider: adapterProvider,
        database: adapterDB,
    })

    scheduledMessageService.initialize(adapterProvider)
    
    adapterProvider.server.post(
        '/v1/messages',
        handleCtx(async (bot, req, res) => {
            const { number, message, urlMedia } = req.body
            await bot.sendMessage(number, message, { media: urlMedia ?? null })
            return res.end('sended')
        })
    )

    httpServer(+PORT)
}

main()