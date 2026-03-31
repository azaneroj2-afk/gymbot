import googleSheetService from './sheets.js'
import chatHistoryService from './chat-history.js'
import 'dotenv/config'
/**
 * @class ScheduledMessageService
 * Esta clase maneja el sistema de mensajes programados.
 * Su responsabilidad es verificar periódicamente los mensajes programados
 * y enviarlos cuando corresponda según la fecha y hora configurada.
 */
class ScheduledMessageService {
    constructor() {
        this.isRunning = false
        this.checkInterval = null
        this.checkIntervalMs = 60 * 1000 // Verificar cada minuto
        this.botInstance = null
    }

    /**
     * Inicializa el servicio de mensajes programados
     * @param {Object} botInstance - Instancia del bot para enviar mensajes
     */
    initialize(botInstance) {
        this.botInstance = botInstance
        this.startScheduler()
        console.log('📅 Servicio de mensajes programados inicializado')
    }

    /**
     * Inicia el programador que verifica mensajes pendientes
     */
    startScheduler() {
        if (this.isRunning) {
            console.log('⚠️ El programador ya está ejecutándose')
            return
        }

        this.isRunning = true
        this.checkInterval = setInterval(async () => {
            await this.checkAndSendPendingMessages()
        }, this.checkIntervalMs)

        console.log(`📅 Programador iniciado - verificando cada ${this.checkIntervalMs / 1000} segundos`)
    }

    /**
     * Detiene el programador
     */
    stopScheduler() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval)
            this.checkInterval = null
        }
        this.isRunning = false
        console.log('📅 Programador detenido')
    }

    /**
     * Verifica y envía mensajes programados que estén pendientes
     */
    async checkAndSendPendingMessages() {
        try {
            const scheduledMessages = await googleSheetService.getScheduledMessages()
            const pendingMessages = this.filterPendingMessages(scheduledMessages)
            const messagesToSend = this.filterMessagesByDateTime(pendingMessages)

            if (messagesToSend.length > 0) {
                console.log(`📅 Encontrados ${messagesToSend.length} mensajes para enviar`)
                
                for (const message of messagesToSend) {
                    await this.sendScheduledMessage(message)
                }
            }
        } catch (error) {
            console.error('❌ Error al verificar mensajes programados:', error)
        }
    }

    /**
     * Filtra mensajes que están en estado "Pendiente"
     * @param {Array} messages - Array de mensajes programados
     * @returns {Array} Mensajes pendientes
     */
    filterPendingMessages(messages) {
        return messages.filter(message => {
            const estado = message.estado?.toLowerCase().trim()
            // Considerar pendientes: null, undefined, vacío, o explícitamente "pendiente"
            return !estado || estado === '' || estado === 'pendiente'
        })
    }

    /**
     * Filtra mensajes que deben enviarse ahora según fecha y hora
     * @param {Array} messages - Array de mensajes pendientes
     * @returns {Array} Mensajes que deben enviarse ahora
     */
    filterMessagesByDateTime(messages) {
        const now = new Date()
        const currentDate = now.toISOString().split('T')[0] // YYYY-MM-DD
        const currentTime = now.toTimeString().substring(0, 5) // HH:MM
        const [currHour, currMin] = currentTime.split(':').map(Number)
        const currTotalMin = currHour * 60 + currMin

        return messages.filter(message => {
            if (!message.fecha || !message.hora) {
                console.log(`⚠️ Mensaje sin fecha o hora válida:`, { fecha: message.fecha, hora: message.hora })
                return false
            }

            const messageDate = message.fecha.trim()
            const messageTime = message.hora.trim()

            // Normalizar fecha a formato YYYY-MM-DD
            let normalizedDate
            if (messageDate.includes('/')) {
                // Formato DD/MM/YYYY
                const [day, month, year] = messageDate.split('/')
                normalizedDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
            } else {
                // Formato YYYY-MM-DD
                normalizedDate = messageDate
            }

            // Verificar si es el día correcto
            if (normalizedDate !== currentDate) {
                return false
            }

            // Verificar hora con tolerancia de ±2 minutos
            const [msgHour, msgMin] = messageTime.split(':').map(Number)
            const msgTotalMin = msgHour * 60 + msgMin
            const diffMin = Math.abs(msgTotalMin - currTotalMin)

            const shouldSend = diffMin <= 2
            if (shouldSend) {
                console.log(`✅ Mensaje programado para envío:`, {
                    fecha: messageDate,
                    hora: messageTime,
                    phone: message.phone,
                    diferencia_minutos: diffMin
                })
            }

            return shouldSend
        })
    }

    /**
     * Envía un mensaje programado
     * @param {Object} message - Objeto del mensaje programado
     */
    async sendScheduledMessage(message) {
        try {
            if (!this.botInstance) {
                throw new Error('Bot instance no está disponible')
            }

            if (!message.phone || !message.addAnswer) {
                throw new Error('Faltan datos requeridos: phone o addAnswer')
            }

            const phoneNumber = this.formatPhoneNumber(message.phone)
            const answer = message.addAnswer
            const mediaUrl = message.media && message.media.trim()

            console.log(`📤 Enviando mensaje programado a ${phoneNumber}`)

            // Enviar mensaje
            const messageOptions = { media: mediaUrl || null }
            await this.botInstance.sendMessage(phoneNumber, answer, messageOptions)

            // Guardar en historial
            await chatHistoryService.saveMessage(phoneNumber, 'assistant', answer)

            // Actualizar estado en Google Sheets
            await googleSheetService.updateMessageStatus(message.rowIndex, 'Enviado')

            console.log(`✅ Mensaje programado enviado exitosamente a ${phoneNumber}`)

        } catch (error) {
            console.error(`❌ Error al enviar mensaje programado:`, error)
            
            // Actualizar estado como error en Google Sheets
            try {
                await googleSheetService.updateMessageStatus(message.rowIndex, 'Error')
            } catch (updateError) {
                console.error('❌ Error al actualizar estado de error:', updateError)
            }
        }
    }

    /**
     * Formatea el número de teléfono para asegurar el formato correcto
     * @param {string} phone - Número de teléfono
     * @returns {string} Número formateado
     */
    formatPhoneNumber(phone) {
        // Remover espacios y caracteres especiales
        let cleanPhone = phone.replace(/[^0-9]/g, '')
        
        // Asegurar que tenga el formato correcto para WhatsApp
        if (!cleanPhone.includes('@')) {
            cleanPhone = cleanPhone + '@s.whatsapp.net'
        }
        
        return cleanPhone
    }

    /**
     * Obtiene estadísticas de mensajes programados
     * @returns {Promise<Object>} Estadísticas
     */
    async getStats() {
        try {
            const scheduledMessages = await googleSheetService.getScheduledMessages()
            
            const stats = {
                total: scheduledMessages.length,
                pendientes: 0,
                enviados: 0,
                errores: 0
            }

            scheduledMessages.forEach(message => {
                const estado = message.estado?.toLowerCase().trim()
                switch (estado) {
                    case 'pendiente':
                    case '':
                    case null:
                        stats.pendientes++
                        break
                    case 'enviado':
                        stats.enviados++
                        break
                    case 'error':
                        stats.errores++
                        break
                }
            })

            return stats
        } catch (error) {
            console.error('❌ Error al obtener estadísticas:', error)
            return { total: 0, pendientes: 0, enviados: 0, errores: 0 }
        }
    }

    /**
     * Fuerza la verificación inmediata de mensajes programados
     */
    async forceCheck() {
        console.log('🔄 Forzando verificación de mensajes programados...')
        await this.checkAndSendPendingMessages()
    }

    /**
     * Reinicia el servicio (útil para recargar configuración)
     */
    restart() {
        console.log('🔄 Reiniciando servicio de mensajes programados...')
        this.stopScheduler()
        googleSheetService.invalidateCache()
        this.startScheduler()
    }
}

const scheduledMessageService = new ScheduledMessageService()
export default scheduledMessageService