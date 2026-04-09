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

// 💰 PLANES FIJOS (Fuente de verdad)
const plans = {
    "1 mes": "💰 S/ 120\nIncluye: Evaluación física, rutina personalizada, plan de nutrición, asesoría.",
    "3 meses": "💰 S/ 299\nIncluye: Evaluación física, rutina personalizada, plan de nutrición, clase grupal de baile fitness 💃, asesoría profesional.",
    "6 meses": "💰 S/ 499\nIncluye: Evaluación física, rutina personalizada, plan de nutrición, clase grupal de baile fitness 💃, asesoría profesional.",
    "1 año": "💰 S/ 599\nIncluye: Evaluación física completa, rutina personalizada, plan de nutrición, clases grupales, asesoría profesional."
}

// 🔥 FLUJO DINÁMICO
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
                if (now < unblockTime) return console.log("🚫 Usuario bloqueado temporalmente:", phoneNumber)
                blockedUsers.delete(phoneNumber)
            }

            // 🚫 BLOQUEO DE PROMPT INJECTION / TROLL
            const forbiddenPatterns = [
                "ignora", "ignore", "actua como", "actúa como",
                "roleplay", "kawaii", "anime", "uwu", "senpai",
                "yamete", "daisuki", "amochito"
            ]
            if (forbiddenPatterns.some(p => userInput.includes(p))) {
                await flowDynamic("🤖 No entiendo tu mensaje, pero puedo mostrarte los planes disponibles.")
                return await flowDynamic("Escribe 'planes' para ver opciones disponibles.")
            }

            // 🛑 DERIVACIÓN A ASESOR HUMANO
            if (userInput.includes('asesor') || userInput.includes('humano') || userInput.includes('persona')) {
                await flowDynamic(`👉 Perfecto, un asesor te atenderá en breve.\n📌 Te responderán por este mismo chat.\n🛒 Mantente atento.`)
                blockedUsers.set(phoneNumber, Date.now() + 1800000) // 30 min
                return
            }

            // 💰 DETECCIÓN DE PAGO
            const pagoPatterns = ["ya pague","ya yapie","ya yapee","pagado","listo","ya hice el pago","ya transferi"]
            if (pagoPatterns.some(p => userInput.includes(p))) {
                await flowDynamic(`👉 Perfecto, tu pago está en proceso de validación.\n👉 Un asesor te atenderá en breve\n📌 Envía tu captura + nombre completo + DNI + celular.`)
                blockedUsers.set(phoneNumber, Date.now() + 10000) // 10 seg
                return
            }

            // 🔍 RESPONDER PLANES FIJOS
            const matchedPlan = Object.keys(plans).find(p => userInput.includes(normalizeText(p)))
            if (matchedPlan) {
                await flowDynamic(`🔥 PLAN ${matchedPlan.toUpperCase()}\n${plans[matchedPlan]}\n🛒 Yapea al 941 398 383 y envía tu captura + escribe "pagado" para activarlo.`)
                return
            }

            // 🔍 BUSCAR FLUJO EN SHEETS
            const triggeredFlow = flows.find(f => {
                if (!f.addKeyword) return false
                const keywords = f.addKeyword.split(',').map(k => normalizeText(k))
                return keywords.some(keyword => userInput.includes(keyword))
            })
            if (triggeredFlow) {
                const answer = triggeredFlow.addAnswer
                const mediaUrl = triggeredFlow.media?.trim()
                await chatHistoryService.saveMessage(phoneNumber, 'user', userInputRaw)
                await chatHistoryService.saveMessage(phoneNumber, 'assistant', answer)
                if (mediaUrl) await flowDynamic(answer, { media: mediaUrl })
                else await flowDynamic(answer)
                return
            }

            // 🤖 SENSIBLES (lesión, dolor, etc.)
            const sensitivePatterns = ["lesion","dolor","medicamento","embarazo","enfermedad","operacion","cirugia","tratamiento","pastilla"]
            if (sensitivePatterns.some(p => userInput.includes(p))) {
                return await flowDynamic("👉 Para esto es mejor hablar con un asesor.\n📌 Te atenderán en breve.")
            }

            // 🤖 FALLBACK IA EDUCATIVA
            let aiResponse = await groqService.getResponse(userInputRaw, phoneNumber)

            // Limitar la respuesta de IA SOLO si no es plan
            if (!matchedPlan && aiResponse.length > 200) aiResponse = aiResponse.slice(0,200)

            // Filtrar respuestas no deseadas de IA
            const invalidPatterns = ["no puedo","lo siento","no estoy programado","kawaii","anime","uwu","senpai","¿como estas?","hablar contigo","sucursales","direcciones","ofertas"]
            if (invalidPatterns.some(p => aiResponse.toLowerCase().includes(p))) {
                return await flowDynamic("Escribe 'planes' para ver opciones disponibles.")
            }

            // Añadir tips
            const nutritionTips = [
                "💡 Recuerda hidratarte antes, durante y después del entrenamiento.",
                "💡 Prioriza proteínas en tus comidas para ganar masa muscular.",
                "💡 Dormir 7-8 horas ayuda a la recuperación y crecimiento muscular."
            ]
            const recoveryTips = [
                "💡 No olvides estirar después de entrenar para evitar lesiones.",
                "💡 Si sientes fatiga, dale tiempo a tu cuerpo de recuperarse.",
                "💡 Masajes o foam roller ayudan a relajar los músculos."
            ]
            const tipPool = nutritionTips.concat(recoveryTips)
            const randomTip = tipPool[Math.floor(Math.random() * tipPool.length)]

            // Respuesta final
            await flowDynamic(`${aiResponse}\n${randomTip}\n💡 Consulta siempre con un asesor si tienes dudas.`)

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
    const adapterProvider = createProvider(Provider, { version: [2, 3000, 1035824857] })

    adapterProvider.on('qr', (qr) => {
        console.log('📱 ESCANEA ESTE QR:')
        qrcode.generate(qr, { small: true })
    })

    const adapterDB = new Database()
    const { handleCtx, httpServer } = await createBot({ flow: adapterFlow, provider: adapterProvider, database: adapterDB })

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