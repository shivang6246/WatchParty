package com.example.watchParty.watchParty.Repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import com.example.watchParty.watchParty.Entity.ChatMessage;

@Repository
public interface ChatMessageRepo extends JpaRepository<ChatMessage, Long> {

    Page<ChatMessage> findByRoomCodeOrderByTimestampDesc(String roomCode, Pageable pageable);

    long countByRoomCode(String roomCode);
}
