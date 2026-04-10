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

const BUSINESS_INFO = {
    mapsUrl: 'https://maps.app.goo.gl/UduDJ34PsHwnpPYs5',
    yapeNumber: '941 398 383'
}

// 🔥 NORMALIZAR TEXTO
const normalizeText = (text) => {
    return String(text || '')
        .toLowerCase()
        .trim()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
}

const includesAny = (text, patterns = []) => {
    return patterns.some(pattern => text.includes(normalizeText(pattern)))
}

const getPlanFromKeyword = (keyword = '') => {
    const normalizedKeyword = normalizeText(keyword)

    if (normalizedKeyword.includes('1 mes')) return '1 mes'
    if (normalizedKeyword.includes('3 meses')) return '3 meses'
    if (normalizedKeyword.includes('6 meses')) return '6 meses'
    if (normalizedKeyword.includes('1 ano')) return '1 año'

    return null
}

const blockedUsers = new Map()
const userContext = new Map()

const getUserState = (phoneNumber) => userContext.get(phoneNumber) || {}

const updateUserState = (phoneNumber, updates) => {
    const currentState = getUserState(phoneNumber)
    userContext.set(phoneNumber, { ...currentState, ...updates })
}

const forbiddenPatterns = [
    "ignora", "ignore", "actua como", "actúa como",
    "roleplay", "kawaii", "anime", "uwu"
]

const locationPatterns = [
    'ubicacion', 'ubicación', 'direccion', 'dirección',
    'donde quedan', 'dónde quedan', 'lugar', 'maps', 'local'
]

const paymentMethodPatterns = [
    'yape', 'yapear', 'metodo de pago', 'método de pago',
    'como pago', 'cómo pago', 'formas de pago', 'pago'
]

const beginnerPatterns = [
    'soy nuevo', 'soy nueva', 'nunca he entrenado',
    'recien empiezo', 'recién empiezo', 'principiante',
    'primera vez', 'nunca fui al gym', 'nunca hice gym', 'soy principiante'
]

const injuryPatterns = [
    'lesion', 'lesión', 'rodilla', 'dolor', 'operacion',
    'operación', 'fisioterapia', 'columna', 'espalda',
    'molestia', 'me lastime', 'me lastimé', 'lumbar', 'manguito rotador'
]

const canTrainPatterns = [
    'entonces no puedo entrenar',
    'si puedo entrenar',
    'sí puedo entrenar',
    'puedo entrenar',
    'no puedo entrenar',
    'puedo entrenar todos los dias'
]

const weightLossPatterns = [
    'bajar de peso', 'bajar grasa', 'quemar grasa',
    'adelgazar', 'perder peso'
]

const dayNightPatterns = [
    'de noche o de dia',
    'de noche o de día',
    'de dia o de noche',
    'de día o de noche',
    'mejor entrenar de noche',
    'mejor entrenar de dia',
    'mejor entrenar de día',
    'cual es el mejor horario'
]

const lowTrafficPatterns = [
    'menos gente', 'mas vacio', 'más vacío',
    'menos afluencia', 'menos lleno', 'mas tranquilo',
    'más tranquilo'
]

const planIntentPatterns = [
    'quiero algo completo',
    'algo completo',
    'cual me recomiendas',
    'cuál me recomiendas',
    'que me recomiendas',
    'qué me recomiendas',
    'recomendado'
]

const dynamicFlow = addKeyword(EVENTS.WELCOME)
    .addAction(async (ctx, { flowDynamic }) => {
        try {
            const flows = await googleSheetService.getFlows()
            const userInputRaw = ctx.body || ''
            const userInput = normalizeText(userInputRaw)
            const phoneNumber = ctx.from
            const userState = getUserState(phoneNumber)
            const now = Date.now()

            console.log(`📩 Mensaje recibido: ${userInputRaw}`)

            const sendReply = async (message, options = {}) => {
                await chatHistoryService.saveMessage(phoneNumber, 'user', userInputRaw)
                await chatHistoryService.saveMessage(phoneNumber, 'assistant', message)

                if (options.media) {
                    await flowDynamic(message, { media: options.media })
                } else {
                    await flowDynamic(message)
                }
            }

            // 🚫 BLOQUEADOS
            if (blockedUsers.has(phoneNumber)) {
                const unblockTime = blockedUsers.get(phoneNumber)
                if (now < unblockTime) return
                blockedUsers.delete(phoneNumber)
            }

            // 🚫 ANTI PROMPT INJECTION
            if (forbiddenPatterns.some(p => userInput.includes(normalizeText(p)))) {
                return await sendReply(
                    "👉 Te ayudo a elegir el mejor plan.\n📌 Escribe *planes*.\n❓ ¿Buscas algo económico o completo?"
                )
            }

            // 👨‍💼 HUMANO
            if (includesAny(userInput, ['asesor', 'humano'])) {
                await sendReply("👉 Un asesor te responderá en breve.")
                blockedUsers.set(phoneNumber, now + 1800000)
                return
            }

            // 💰 PAGO CONFIRMADO
            if (
                includesAny(userInput, [
                    'ya pague', 'ya pagué', 'pagado',
                    'ya yap', 'listo', 'ya hice el yape'
                ])
            ) {
                await sendReply(
                    "👉 ¡Gracias! Estamos validando tu pago.\n📌 En breve un asesor te escribirá para continuar con tu inscripción."
                )
                blockedUsers.set(phoneNumber, now + 10000)
                return
            }

            // 📍 UBICACIÓN
            if (includesAny(userInput, locationPatterns)) {
                updateUserState(phoneNumber, { lastIntent: 'location' })

                return await sendReply(
                    `👉 Aquí tienes la ubicación exacta:\n${BUSINESS_INFO.mapsUrl}\n📌 Si quieres, también puedes visitarnos primero y luego activar tu plan.`
                )
            }

            // 💳 MÉTODO DE PAGO
            if (includesAny(userInput, paymentMethodPatterns)) {
                updateUserState(phoneNumber, { lastIntent: 'payment' })

                return await sendReply(
                    `👉 Solo trabajamos con *Yape*.\n📌 Yapea al *${BUSINESS_INFO.yapeNumber}*\n📌 Luego envía tu captura.\n❓ ¿Qué plan quieres activar?`
                )
            }

            // 🩹 LESIÓN / DOLOR
            if (includesAny(userInput, injuryPatterns)) {
                updateUserState(phoneNumber, {
                    lastIntent: 'injury',
                    hasInjury: true
                })

                return await sendReply(
                    "👉 Sí podrías entrenar, pero de forma adaptada.\n📌 Si tienes una lesión o molestia, primero debemos evaluarte para no empeorarla.\n💡 Todos los planes incluyen evaluación física.\n❓ ¿Tu lesión está diagnosticada y ahora mismo sientes dolor al caminar, agacharte o hacer fuerza?"
                )
            }

            // ❓ SI PUEDE ENTRENAR O NO
            if (includesAny(userInput, canTrainPatterns)) {
                updateUserState(phoneNumber, { lastIntent: 'can_train' })

                return await sendReply(
                    "👉 No necesariamente significa que no puedas entrenar.\n📌 Muchas personas entrenan con adaptación, pero primero habría que evaluarte para no empeorar la molestia.\n💡 Si quieres, te orientamos según tu caso."
                )
            }

            // 🆕 PRINCIPIANTE
            if (includesAny(userInput, beginnerPatterns)) {
                updateUserState(phoneNumber, {
                    lastIntent: 'beginner',
                    level: 'principiante'
                })

                return await sendReply(
                    "👉 Si recién empiezas, no te preocupes.\n📌 La rutina se adapta a tu nivel desde cero.\n💡 Empezamos de forma progresiva según tu objetivo.\n❓ ¿Buscas bajar de peso, tonificar o ganar masa?"
                )
            }

            // ⏰ DÍA O NOCHE
            if (includesAny(userInput, dayNightPatterns)) {
                updateUserState(phoneNumber, { lastIntent: 'schedule_advice' })

                return await sendReply(
                    "👉 Para ver resultados, lo más importante no es si entrenas de día o de noche, sino el horario que puedas mantener con constancia.\n📌 Si en el día tienes más energía, perfecto; si por trabajo te acomoda más la noche, también funciona.\n❓ Si quieres, te recomiendo el horario según tu rutina."
                )
            }

            // 👥 MENOS GENTE
            if (includesAny(userInput, lowTrafficPatterns)) {
                updateUserState(phoneNumber, { lastIntent: 'low_traffic' })

                return await sendReply(
                    "👉 Si buscas entrenar más tranquila, te podemos orientar según el turno que prefieras.\n📌 La afluencia puede variar según el día.\n❓ ¿Prefieres mañana, tarde o noche?"
                )
            }

            // 🔥 PRIORIDAD PLANES / PRECIOS
            if (
                includesAny(userInput, [
                    'planes', 'ver planes', 'opciones',
                    'precio', 'precios'
                ])
            ) {
                const planFlow = flows.find(f =>
                    f.addKeyword &&
                    normalizeText(f.addKeyword).includes('planes')
                )

                if (planFlow) {
                    console.log("🔥 Forzando flujo PLANES")
                    updateUserState(phoneNumber, { lastIntent: 'plans' })
                    await sendReply(planFlow.addAnswer)
                    return
                }
            }

            // 🎯 INTENCIÓN DE COMPRA CONTROLADA
            if (includesAny(userInput, planIntentPatterns)) {
                const plan3 = flows.find(f =>
                    f.addKeyword &&
                    normalizeText(f.addKeyword).includes('3 meses')
                )

                if (plan3) {
                    console.log("🎯 Redirigiendo a plan 3 meses")
                    updateUserState(phoneNumber, {
                        lastIntent: 'sales',
                        selectedPlan: '3 meses'
                    })

                    await sendReply(plan3.addAnswer)
                    return
                }
            }

            // 🔍 DETECTAR FLUJO NORMAL
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
                const detectedPlan = getPlanFromKeyword(triggeredFlow.addKeyword)

                if (detectedPlan) {
                    updateUserState(phoneNumber, {
                        selectedPlan: detectedPlan,
                        lastIntent: 'plan_selected'
                    })
                }

                if (mediaUrl) {
                    await sendReply(answer, { media: mediaUrl })
                } else {
                    await sendReply(answer)
                }
                return
            }

            // 🧠 DETECTAR SI ES PREGUNTA
            const isQuestion = [
                "?", "como", "cómo", "cuanto", "cuánto", "cuantos", "cuántos",
                "puedo", "cada cuanto", "cada cuánto", "es bueno", "recomiendas",
                "se puede", "tiene", "incluye", "donde", "dónde",
                "ubicacion", "ubicación", "horario", "dias", "días"
            ].some(q => userInput.includes(normalizeText(q)))

            if (!isQuestion) {
                return await sendReply(
                    "👉 Te ayudo a elegir el mejor plan.\n📌 Escribe *planes*.\n❓ ¿Buscas algo económico o completo?"
                )
            }

            // 🤖 IA CONTROLADA
            console.log("🤖 Usando IA...")
            let aiResponse = await groqService.getResponse(userInputRaw, phoneNumber)

            const shouldReinforceSelectedPlan =
                userState.selectedPlan &&
                includesAny(userInput, [
                    'planes', 'plan', 'precio', 'precios',
                    'quiero', 'pagar', 'activar', 'inscribirme',
                    'me interesa', 'cual', 'cuál'
                ])

            if (
                shouldReinforceSelectedPlan &&
                !normalizeText(aiResponse).includes(normalizeText(userState.selectedPlan))
            ) {
                aiResponse += `\n💡 Puedes elegir el plan de ${userState.selectedPlan}`
            }

            // 🚫 BLOQUEAR PROMOCIONES INVENTADAS POR IA
            const forbiddenSalesTerms = [
                "descuento", "oferta", "promocion", "promoción",
                "rebaja", "2x1", "gratis", "precio especial"
            ]

            if (includesAny(normalizeText(aiResponse), forbiddenSalesTerms)) {
                return await sendReply(
                    "👉 No contamos con promociones adicionales.\n❓ ¿Quieres ver los planes disponibles?"
                )
            }

            // 🚫 SOLO YAPE COMO MÉTODO DE PAGO
            const unsupportedPaymentTerms = [
                'tarjeta', 'visa', 'mastercard', 'transferencia',
                'deposito', 'depósito', 'plin'
            ]

            if (includesAny(normalizeText(aiResponse), unsupportedPaymentTerms)) {
                return await sendReply(
                    `👉 El método de pago disponible es solo *Yape*.\n📌 Yapea al *${BUSINESS_INFO.yapeNumber}* y envía tu captura.\n❓ ¿Qué plan te interesa?`
                )
            }

            // ✂️ LIMPIAR RESPUESTAS REPETIDAS
            aiResponse = aiResponse.replace(/(\❓.*\n?){2,}/g, '❓ ¿Quieres ver los planes disponibles?\n').trim()

            // 🔒 CONTROL FINAL
            if (!aiResponse) {
                return await sendReply(
                    "👉 Escribe *planes* para ver las opciones disponibles."
                )
            }

            if (aiResponse.length > 450) {
                aiResponse = `${aiResponse.slice(0, 430).trim()}\n\n❓ ¿Quieres que te recomiende un plan?`
            }

            await sendReply(aiResponse)

        } catch (error) {
            console.error('❌ Error en dynamicFlow:', error)
            await flowDynamic(
                "👉 Escribe *planes* para ver las opciones disponibles."
            )
        }
    })

// 🚀 CONFIGURACIÓN
const main = async () => {
    await googleSheetService.getFlows()
    await googleSheetService.getPrompts()
    await googleSheetService.getScheduledMessages()

    const adapterFlow = createFlow([dynamicFlow])

    const adapterProvider = createProvider(Provider, {
        version: [2, 3000, 1035824857]
    })

    adapterProvider.on('qr', (qr) => {
        console.log('📱 ESCANEA ESTE QR:')
        qrcode.generate(qr, { small: true })
    })

    const adapterDB = new Database()

    const { httpServer } = await createBot({
        flow: adapterFlow,
        provider: adapterProvider,
        database: adapterDB,
    })

    scheduledMessageService.initialize(adapterProvider)

    httpServer(+PORT)
}

main()
