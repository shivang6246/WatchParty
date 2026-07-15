package com.example.watchParty.watchParty.Config;

import java.time.Duration;
import java.util.HashMap;
import java.util.Map;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.cache.RedisCacheConfiguration;
import org.springframework.data.redis.cache.RedisCacheManager;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.serializer.GenericJackson2JsonRedisSerializer;
import org.springframework.data.redis.serializer.RedisSerializationContext;
import org.springframework.data.redis.serializer.StringRedisSerializer;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;

@Configuration
public class RedisConfig {

        @Value("${app.cache.default-ttl-minutes:10}")
        private long defaultTtlMinutes;

        /**
         * Creates an ObjectMapper configured for Redis serialization with Java 8
         * date/time support.
         */
        private GenericJackson2JsonRedisSerializer jsonRedisSerializer() {
                ObjectMapper mapper = new ObjectMapper();
                mapper.registerModule(new JavaTimeModule());
                mapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
                mapper.activateDefaultTyping(
                                mapper.getPolymorphicTypeValidator(),
                                ObjectMapper.DefaultTyping.NON_FINAL);
                return new GenericJackson2JsonRedisSerializer(mapper);
        }

        @Bean
        public StringRedisTemplate stringRedisTemplate(RedisConnectionFactory connectionFactory) {
                return new StringRedisTemplate(connectionFactory);
        }

        @Bean
        public RedisTemplate<String, Object> redisTemplate(RedisConnectionFactory connectionFactory) {
                RedisTemplate<String, Object> template = new RedisTemplate<>();
                template.setConnectionFactory(connectionFactory);
                template.setKeySerializer(new StringRedisSerializer());
                template.setValueSerializer(jsonRedisSerializer());
                template.setHashKeySerializer(new StringRedisSerializer());
                template.setHashValueSerializer(jsonRedisSerializer());
                template.afterPropertiesSet();
                return template;
        }

        @Bean
        public RedisCacheManager cacheManager(RedisConnectionFactory connectionFactory) {
                GenericJackson2JsonRedisSerializer serializer = jsonRedisSerializer();

                RedisCacheConfiguration defaultConfig = RedisCacheConfiguration.defaultCacheConfig()
                                .entryTtl(Duration.ofMinutes(defaultTtlMinutes))
                                .serializeKeysWith(
                                                RedisSerializationContext.SerializationPair
                                                                .fromSerializer(new StringRedisSerializer()))
                                .serializeValuesWith(
                                                RedisSerializationContext.SerializationPair.fromSerializer(serializer))
                                .disableCachingNullValues();

                // Per-cache TTL overrides
                Map<String, RedisCacheConfiguration> cacheConfigurations = new HashMap<>();

                cacheConfigurations.put("room_details",
                                defaultConfig.entryTtl(Duration.ofMinutes(5)));

                cacheConfigurations.put("room_members",
                                defaultConfig.entryTtl(Duration.ofMinutes(5)));

                cacheConfigurations.put("room_invite",
                                defaultConfig.entryTtl(Duration.ofMinutes(30)));

                cacheConfigurations.put("playback_state",
                                defaultConfig.entryTtl(Duration.ofSeconds(60)));

                cacheConfigurations.put("user_details",
                                defaultConfig.entryTtl(Duration.ofMinutes(15)));

                cacheConfigurations.put("chat_history",
                                defaultConfig.entryTtl(Duration.ofMinutes(2)));

                return RedisCacheManager.builder(connectionFactory)
                                .cacheDefaults(defaultConfig)
                                .withInitialCacheConfigurations(cacheConfigurations)
                                .transactionAware()
                                .build();
        }
}
