package com.robotgui

import android.content.Context
import org.yaml.snakeyaml.Yaml
import java.io.InputStreamReader

object ConfigManager {
    private var config: Map<String, Any> = mapOf()

    fun init(context: Context) {
        try {
            val inputStream = context.assets.open("config.yaml")
            val yaml = Yaml()
            @Suppress("UNCHECKED_CAST")
            config = yaml.load(InputStreamReader(inputStream)) as Map<String, Any>
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    fun getString(key: String, defaultValue: String = ""): String {
        return config[key]?.toString() ?: defaultValue
    }

    fun getInt(key: String, defaultValue: Int = 0): Int {
        return config[key]?.toString()?.toIntOrNull() ?: defaultValue
    }

    fun getNestedString(path: String, defaultValue: String = ""): String {
        return getNestedValue(path)?.toString() ?: defaultValue
    }

    fun getDoubleArray(key: String): DoubleArray? {
        val value = getNestedValue(key)
        return (value as? List<*>)?.mapNotNull { 
            (it as? Number)?.toDouble() 
        }?.toDoubleArray()
    }

    @Suppress("UNCHECKED_CAST")
    private fun getNestedValue(path: String): Any? {
        val keys = path.split(".")
        var current: Any? = config

        for (key in keys) {
            current = (current as? Map<String, Any>)?.get(key)
            if (current == null) return null
        }

        return current
    }

    @JvmStatic
    fun getNestedList(path: String): List<Any>? {
        return getNestedValue(path) as? List<Any>
    }

    // Add more getters as needed
} 