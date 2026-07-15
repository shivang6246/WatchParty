package com.example.watchParty.watchParty.Repository;

import java.util.List;
import java.util.Optional;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import com.example.watchParty.watchParty.Entity.Room;

@Repository
public interface roomRepo extends JpaRepository<Room, Long> {

    Optional<Room> findByRoomCode(String roomCode);

    boolean existsByRoomCode(String roomCode);

    Optional<Room> findByHost(String host);

    List<Room> findByActiveTrue();

    Optional<Room> findByInviteToken(String inviteToken);
}